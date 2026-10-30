# Trust of a builtin's words, from what their fields may be

Status: in progress (2026-10-30). The maintainer approved a redesign: "a design document first, then steps that keep every test passing". Step 1, the field domain (src/semantics/fieldshape.ts), is done; nothing reads it yet, and it is to be reviewed before step 2. Step 0 is done (#504). The roadmap item is under "Deferred until after 0.10.0" (2026-10-31) in [../roadmap.md](../roadmap.md).

The condition and dead-code model (`shellState(…).condition(n)`, `.dead(n)`; [semantics.md](semantics.md), 4.14) may decide nothing that a builtin changes unseen. Some builtins read words that expand at run time, and those words can change what the builtin sets: `printf $x u 2` sets `u` when `$x` is `-v`. PRs #498 and #501 built the check for this from special cases. Each review round found a new hole. This page replaces the special cases with one rule about the fields of a word, and two kinds of stated facts: when the code runs, and which values a variable may have there.

Every claim about bash on this page was checked with bash 5.2 (`bash` of this machine), each snippet in its own shell, in a cgroup (`systemd-run --user --scope -p MemoryMax=3G -p MemorySwapMax=0 -p TasksMax=500`) with `FUNCNEST` set. Section 3.3 lists the checks.

## 1. Today

### 1.1 The mechanism

The trust scan (src/semantics/trust.ts) reads the whole script once. A builtin whose words say what it sets (`set`, the declarations, a builtin whose options or operands name variables or functions: `namesByWords`) may have words whose value is not known where they stand. `unknownWords` (src/semantics/deferred.ts) collects them, unless `inert` says that no field of the word can change what the builtin sets. At the end of the scan, `readDeferred` reads each such builtin again:

- `deferredReadings` lists the values the script writes to each variable of the words (`valuesOf`, from `valuesWritten` in src/semantics/writechecks.ts), with "unset" too. It reads the words as the fields of each tuple of values (`fieldReadings`, with braces on and off), up to 16 readings. Each reading gives an effect key (`effectKey` in src/semantics/effects.ts: the flags, the variables set and how, the callbacks, `set`'s options, a declaration's operands). The scan reads the builtin once per key.
- Where it cannot list the values (a write it does not follow, `$1`, an IFS the script sets, past the 16 readings), it reads the words as written. It hands the walk a plan (`DeferredPlan`: the words, the keys, and `written`, whether every value was read and each gave the key as written).
- The walk (`fieldsIn` in src/semantics/walk/builtins.ts) reads the fields where it runs the builtin, from the variables whose every value it follows (`Trust.valuesKnown`). Where it knows them, their key must be one the scan read. Where it does not, the plan must be `written`, and every variable must have a value the script wrote there (`readsUnwritten`). Otherwise it walks again with nothing trusted.
- Code that runs at a time of its own (a trap's action, an alias's text, a function a callback runs) is walked from an older state (`widen`). There the scan trusts nothing unless the plan is `written` and no variable of the words is a function's local or a prefix assignment (`Scan.finish`, `late`).

### 1.2 The special cases, and the hole each one patched

Each row is a rule of the code today. The hole is the counterexample that made it, from the PR or commit that added it. "Wrong" means the model decided a condition that bash does not take that way.

| # | Rule (where) | The hole it patched |
| --- | --- | --- |
| S1 | Read a deferred word as the fields of each value the script writes, and of none (`readDeferred`, #498) | Before #498, words were read as written: `x=-v; printf $x u 2` decided `u` wrongly. |
| S2 | List a variable's values only where every write is a plain assignment of known text, or an unset (`valuesWritten`, #501) | #498 read as written where it could not list: `for x in -v; do :; done; printf $x u 2`, and `read`, `x=(-v)`, `x[0]=`, `${x:=}`, `mapfile`, `select`, `declare -l`, namerefs, `REPLY`, `OPTARG`, `_`, `$1`, all wrong. |
| S3 | `unset x` and `local x` count as the value "none" (`valuesWritten`, #501) | A loss of #498, not a wrong decision: `x=-v; unset x; printf $x u 2` trusted nothing. |
| S4 | A variable the script gives no text has the environment's value (`valuesOf`); the walk checks each variable has a value the script wrote where the builtin runs (`readsUnwritten`, #501) | `printf $x u 2; x=a` with `x=-v` in the environment. |
| S5 | The plan, and the walk's check of the key (`DeferredPlan`, `fieldsIn`, #501) | The scan's values are those of the whole script; the walk has those of the place, and may know fewer. |
| S6 | An IFS the script sets: read as written (`ifs` in `deferredReadings`, #501) | The readings split with the default IFS. |
| S7 | Readings start in the mode the shell starts in (`posix` in `fieldReadings`, #501) | Whether `command declare a=$v` splits `$v` depends on POSIX mode (3.3, F21, F22). |
| S8 | At most 16 readings, counting only the words that can change the key given the readings of the words before (`READINGS`, `inertAfter`, #501) | `x=-v; printf $x u 2 $a $b $c $d` passed the cap on words that cannot matter. |
| S9 | `inert`: a word that cannot change the key: one value of an option that names nothing (`read -p "$p" x`); an operand after an operand or `--`; an operand that starts with text other than `-` or `+` (#498, 353475a5) | A loss of #501: `printf "Usage: $0\n"`, `printf "now $d\n"` trusted nothing. |
| S10 | `inert` counts the operand places past the written words where a word may give more fields (`builtinRead(…, more)`, 166ac766) | `o='v u'; getopts -- $o` sets `u`: wrong on main and before #498. |
| S11 | `literalStart` takes the start after quote removal, from the word model (9399193e) | It read the raw text: `x=; printf "\<newline>-v$x" u 2` is `printf -v u 2`, wrong. |
| S12 | Late code may be read as written only with a `written` plan (353475a5) | Before, late code trusted nothing: `trap cleanup EXIT` with `printf "${RED}bye${NC}\n"`. `widen` now keeps a variable not set there as `kept`: `trap 'printf "$msg\n"' INT; msg=hi`. |
| S13 | In late code, no variable of the words may be a function's local (9399193e) | `f() { local m=hi; trap 'printf $m u 2' ERR; }; m=-v; f; false` sets `u`, wrong. |
| S14 | …nor a prefix assignment of a command (c8b042c3) | `g() { trap 'printf $m u 2' ERR; }; m=hi g; false` with `m=-v` in the environment sets `u`, wrong. |
| S15 | A reading must not set a variable the deferred words read, nor make it a nameref's target (`readDeferred`, #498) | The values listed would then be incomplete. |
| S16 | A word that expands nothing is a glob at most, taken as matching no file (`unknownWords`, #498) | `declare a[1]` would trust nothing. |
| S17 | `unset`, `shopt`, `enable`, `eval`, `trap`, `alias`, `let`, `compgen`, `fc` are read as written (`AS_WRITTEN`) | They have handlers of their own; `x=a; unset $x` trusts nothing. |

The pattern is the one trust-allow-list.md, section 1, describes for constructs: each rule names a case, and the next review finds the case next to it. S9 to S11 are three views of one question (what can this word's fields be?). S12 to S14 are three views of another (what value can this variable have when this code runs?).

### 1.3 What trusts nothing today

These lines make the whole script trust nothing at c8b042c3 ("a builtin is given a word whose fields the trust read, which are not known here"). Main before #501 decided them, as written.

```bash
RED=$(tput setaf 1); NC=$(tput sgr0); printf "${RED}err${NC}\n"
printf "${BOLD}Title${RESET}\n"                 # both never set
while read -r line; do printf "$line\n"; done
msg=$1; printf "$msg\n"
printf "${1:-default}\n"
die() { printf "$1\n"; }
printf "$(date +%F) msg\n"
for f in *; do printf "$f\n"; done
pad=$(…); printf "$pad%s\n" a
declare -a "arr=($x)"
printf "$f"
```

A review of #501 noted the point this page builds on: a field that ends in literal text such as `\n` can never be a valid name, so even after `-v` nothing is assigned (3.3, F1, F2).

`declare -a "arr=($x)"` is different: main before #501 decided it wrongly. bash reads the text of a compound assignment given to a declaration again, as code, where that text is not the word's own syntax: `x='[y=5]=1'; declare -a "arr=($x)"` sets `y` to 5 (3.3, F50). The same happens with static text, and the model decides it wrongly on main today (section 5, step 0).

## 2. The model

### 2.1 Three questions and one rule

A builtin's effect depends on three things. The design keeps them apart:

- **F, the fields.** What can the fields of this word be, given what each of its parts may be? This is a question about the word and the shell options where it expands (braces, IFS, globbing, POSIX mode). It does not ask where a value comes from.
- **V, the values.** What values can this parameter have where the word expands? This is a question about the script: its writes, their scope, and when the code runs.
- **E, the effect.** Given such fields, what can the builtin change? This is a question for the builtin's spec reader (src/argv/).

**The rule.** Let E₀ be the effect the model gives the builtin (as written, or from the fields it knows). The model may trust a builtin's words when every effect that E allows for the fields that F allows, with the values that V allows, is E₀. Otherwise the effects it allows must all be known (no name not known), and the model applies each of them as one that may happen; where some effect names a variable not known, nothing is trusted.

**Shape first.** F is first asked with every part not known (no values at all). If the word's shape alone allows only E₀, nothing more is needed: no values, no plan for the walk, and nothing about time or scope. This is how the idioms of section 1.3 are decided (section 4). V, and the facts of time and scope, are needed only for a word whose shape alone may change the effect (`set $x`, `declare $x`, `printf $x u 2`, `getopts -- $o`).

### 2.2 The field domain

A part of a word is either known (a text, or unset) or a **hole**. A hole has a kind, is quoted or not, and may be empty or not (`Hole` in src/semantics/fieldshape.ts: `{ kind, quoted, empty }`):

| Kind | What it may give | From |
| --- | --- | --- |
| `text` | any text, also empty | a value not known, `$( )`, `$1`, `$0`, a tilde, `$"…"`, `<( )` (never empty) |
| `digits` | digits; for `$!`, maybe nothing | `$#`, `$?`, `$$`, `${#x}`, `${#a[@]}` (never empty), also `${#-w}` and the like; `$!` (empty before any `&`: F62). Another operator over them gives `text` (F79) |
| `integer` | digits, maybe after a `-` | `$(( ))`, even a constant one (F31: `printf $((-5))` is an invalid option; F75) |
| `elements` | no field, or any number of fields of any text | `"$@"`, `"${a[@]}"`, `$@`, `$*` and `${a[*]}` unquoted, an indirection or a nameref that may name `a[@]` (`severalFields` of src/semantics/globwords.ts) |

A hole may be empty unless its kind says it never is. An unquoted empty hole alone gives no field: `printf $! -vu 2` sets `u` (F62). Only variables take values (V); special and positional parameters are always holes.

A field is described by:

```ts
interface Field {
  text?: string;   // known in full
  start: string;   // its known literal start: the text before its first hole
  end: string;     // its known literal end: the text after its last hole
  head?: Hole;     // the hole it starts with, where `start` is empty (when it is never empty, its kind bounds the first character)
  tail?: Hole;     // the hole it ends with, where `end` is empty
  pattern?: string | true;  // before pathname expansion only: the field as a glob pattern, or true where it may be one
}
```

Where `text` is undefined, the field is any text that starts with `start`, ends with `end`, and is at least as long as both together. The text between is not kept.

A word gives a list of **shapes**, one for each word of its brace expansion, in order. A shape is a count and fields:

```ts
type Shape =
  | { fields: Field[] }                                               // an exact count, each field described
  | { min: number; max?: number; first: Field; middle: Field; last: Field };  // a count in a range (max absent: no bound)
```

With an open count, the first field has the word's literal start, the last the word's literal end, and every field between is any text (also empty where IFS may hold a character that is not blank: F20). With one field, it is both the first and the last. Runs of fields that may be absent (`$!` alone, a pattern with nullglob) also give a count in a range: the first is then what every field that may come first has in common (a *join*: the common start and end), and so on. A word's result is a union of lists of shapes: one list for each case that is not known (braces on or off, each tuple of the known values it enumerates, each reading of a `${x:+w}` over a hole, and the readings of F73), and whether bash may fail on the word (`mayFail`: `set -u`, `${x:?}`, failglob, an arithmetic error).

The API: `wordShapes(n, model, values?, { glob? })` gives `{ cases: Shape[][], mayFail }` (undefined outside a word, for a shell other than bash, where the brace words are not known, `{,$x}a`, and for the words of section 7 the word model reads otherwise than bash). `mayFail` also covers F80 and F86: `${x:=w}` where `x` cannot be assigned (also `FUNCNAME` and the other arrays bash keeps, an element of `x[@]`, or `w` not an integer for `-i`), a transformation or case operator bash refuses (`${x@}`, `${!x@Q}`; `${!x@}` lists names and does not fail, F85). `values` maps a variable to the texts it may have (null: unset), up to `TUPLES` (16, K of section 6) tuples; with none, every part is a hole (shape first). A value given is not taken for a special or positional parameter, a variable bash sets itself (`RANDOM`, `LINENO`, `_`), an array, a nameref (`declare -n r='a[@]'`: `"$r"` gives elements), one with `-i`, `-l` or `-u`, one the word may assign (`${x:=a}$x`; by arithmetic, in a subscript or an offset too, `${z:x=1}$x`, F87; any variable, where that arithmetic reads a name or an expansion, F89), nor after a `source` the walk does not read: each is a hole. `glob: false` stops before pathname expansion and marks each field's `pattern`, which `wordPatterns` (globwords.ts) needs in step 3; `mayGiveNone` is the view `mayGiveNoField` (nofield.ts) needs. `fieldHolds`, `mayStartWith`, `mayBeName`, `mayBeAssignment` and `mayNameFunction` are the questions below; `shapesHold` says whether a list of fields fits a result.

Four questions are asked of a field. Each is decided from `text`, or from `start`, `end`, `head` and `tail`:

- *May it equal t?* (`--`, `-`): t starts with `start`, ends with `end`, and is long enough.
- *May it start with c?* (`-`, `+`): `start` starts with c; or `start` is empty and its head is a `text` or `elements` hole, or an `integer` hole for `-`; or its head may be empty and what follows may start with c.
- *May it be a name?* This is the test for a variable's name. A name is an identifier, or one with a subscript (`a[i]`: F6, F46). No, when its first known character is not a letter or `_`, when its known end neither ends with `]` nor is all letters, digits and `_` (`\n`), or when a character of its known start before a `[` is not a letter, digit or `_`. A field of one `digits` hole is no name.
- *May it be an assignment?* (declarations) `name=…`, `name+=…`, `name[…]=…`. No, when its first known character is not a letter or `_`, or when its known start, before its first `=`, `+=` or `[`, holds a character that is not a letter, digit or `_`. Its end does not matter: `declare "$x\n"` with `x='a='` sets `a` (F40); `declare 'a+=2'` appends (F67).
- *A function's name* (the operands under `-f`: `export -f`, `declare -f`, `readonly -f`, `unset -f`) has a rule of its own. bash 5.2 accepts names a variable cannot have: `f.(){ :; }; x=f; export -f "$x."` exports `f.` (F66). So any field that may be non-empty may name a function; only a known text names a known one.

These are all the spec reader asks of a field's text (section 2.4). Its exact text is asked only where it is known.

### 2.3 Computing it from the word model

The fields come from the word model (`wordMeaning`, `partMeaning` and the pieces of `braceWords` in src/semantics/words.ts), as `mayGiveNoField` (src/semantics/nofield.ts) and `wordPatterns` (src/semantics/globwords.ts) already do with holes. The word model applies bash's order (manual 3.5): brace expansion, tilde, parameter and command substitution and arithmetic, word splitting, filename expansion, quote removal.

1. **Braces.** Each word of the brace expansion is a shape of its own. Where brace expansion may be on or off in the state, both are read.
2. **Parts.** Each part takes its value from V: a known text or unset, enumerated (up to K tuples, section 6), or a hole of the kind the table above gives. An operator over a hole gives a `text` hole, except `${#x}` (`digits`), and `${x:+w}` and `${x+w}`, which give w or nothing (both are read, where w expands nothing; else a `text` hole). An operator over known values is evaluated by the word model. A `$( )` is always a hole, and so is `$(( ))` (F75).
3. **Pieces.** The word becomes pieces: literal text (never split: only the results of expansions are, manual 3.5.7; F43), known expanded text (quoted or not), and holes (quoted or not). Quote removal has already been done on the literal pieces (`"\<newline>-v"` is `-v`: F7).
4. **Splitting.** A field can end only inside an unquoted expanded piece. A known piece splits by the IFS where that IFS is known. Where it is not known (the script sets IFS on some path), an unquoted known piece is read as a `text` hole: its split points are not known. An unquoted `text` hole may split anywhere; an `integer` hole only where IFS may hold `-` or a digit, a `digits` hole only where it may hold a digit. A word whose every piece may be empty and unquoted may give no field. A quoted hole never splits; an `elements` hole gives its own count (`"-v$@"` keeps `-v` on its first field: F44), also with an empty IFS. Three facts of bash found by the generator of step 1 refine this. In the double quotes that hold an `elements` part, an empty part gives no field, nor do the quotes (`"$@$x"` with no element and `x` empty: none, F74), and the parts after it but a variable alone, and a `$(( ))` anywhere in them, are split as if not quoted (`"$@$#"` with `IFS=1` drops the `1`, F75; `"$((-1))$@"` with `IFS=-`, F84): the evaluator of the word model makes each such part a hole that is not quoted. An empty `$!` (before any `&`) that is the last expansion of a word turns word splitting off for the word (`${x-a b}$!` is one field, F73): such a word is read with splitting and without. Bash splits the whole word by the IFS it has after the word's own expansions (`${IFS=:}$x` splits `$x` at `:`, F88): a word whose arithmetic may assign IFS (directly, or through a value or an indirection's subscript read as arithmetic, F89) splits by an IFS not known that may hold digits and `-`, and one that may assign IFS otherwise is not known (section 7).
5. **Globbing.** A field with an unquoted glob character, or with an unquoted expanded piece that may hold one, is a pattern (a backslash alone makes none: F77). Its matches keep its known start before its first character that may be special in the pattern, and its known end after its last; the field is one of its matches, or itself where none matches, so the description joins the two. Five facts decide what those characters are. A backslash in the pattern quotes the next character: the value `\-v*` matches `-vu` (F63), so the start is read in the pattern as bash makes it, quoted characters escaped. So a value that ends in `\` turns the quoted character after it into a special one (`$1"*"` with `$1` a backslash matches `\-vu`, F76). Where `nocaseglob` may be on, a letter matches either case: `-V*` matches `-vu` (F64), so the start ends at its first letter. Where `extglob` may be on, `!`, `@`, `+`, `?` and `*` before `(`, and parentheses and `|`, are special: `!(zz)` matches `-vu` (F65), so the start ends there. A tilde prefix with a glob character names no user and stays as written: `~*` is a pattern, not split (F78). Where `globstar` may be on, `**/` may match nothing, its `/` too (`d/**/x` matches `d/x`, F94), so a `/` next to a special character is special. `nocaseglob`, `extglob` and `globstar` are facts of the state, as `nullglob` is. A pattern field keeps `start` and `end` cut so, and gets a count from one up (none where `nullglob` may be on). This holds without the assumption that a glob matches no file (F34: `x='*'` with a file named `-vu` makes `printf $x 2` set `u`). The assumption stays only for a pattern in the script's own text with no expansion (`declare a[1]`, section 7).
6. **The result.** The shapes of each case not known, as a union.

The mode where the word expands is a fact of the state (section 2.5). POSIX mode decides whether `command declare a=$v` reads `a=$v` as an assignment (no split) or as a word (split): bash 5.2 splits it when not in POSIX mode, and does not split it in POSIX mode (F21, F22; manual 6.11: "when not in POSIX mode, assignment builtins lose their assignment statement expansion properties when preceded by command"). The word model's context rule decides it; where the mode is not known, both are read. (The comment at `fieldReadings` today says the reverse; step 4 rewrites it.)

### 2.4 The question to the spec reader

The question: for a builtin, its spec, and a line of words each known or given by shapes, which effects can bash give it?

**The effect.** What the builtin changes in the shell: each variable or function it sets, unsets, declares or gives an attribute to, with how (`variableWrites`); the options it turns on or off (`setOptionWrites`); the functions it will call (`callbacks`); and whether it runs text as code (a subscript in a name, `printf -v 'a[y=5]'`: F6; a compound assignment read again, F50, F57). Text run as code that is not known is `?`, as a name not known is. It is today's `effectKey` with one change: an option flag counts only through what it makes the builtin do. A flag that changes only the output (`-p`, a `printf` format) adds nothing. A name that the effect cannot know is `?`: the scan then trusts nothing, as it does today for `read "$v"`.

**Refusals.** bash refuses some lines, and then changes nothing (status 1 or 2). Each of these was checked (section 3.3):

- An invalid option letter, also inside a cluster: nothing (F5, F10; `set`, F36, checks every letter first).
- An option whose value is missing, or a missing operand the builtin needs: nothing. `printf -vu`, `printf -v u` and `printf --` have no format (F3, F4). So a `printf` given one field sets nothing, whatever the field is (F35).
- A name that is not valid: `printf -v`, `read`, `mapfile` and `getopts` refuse the whole command (F1, F11, F14, F15); the declarations (`declare`, `local`, `export`, `readonly`) skip that name and go on (F9, F12); `unset` ignores it (F13).
- `-` alone ends the options and is an operand (F4, F29). An option after an operand is an operand (F30).

The spec reader knows most of these already (`missing`, `parse.unmatched`, the `refused` outcome of src/argv/readings.ts). Step 2 adds the rule for invalid names to the builtins' specs (`OperandSpec`: whether a name bash refuses stops the command or is skipped), checked against bash.

**Reading abstract fields.** `interpret` reads words of known text. A word of text not known is read as an operand, never as an option. So the reader turns abstract fields into a finite set of lines of known text, and reads each with `builtinRead`:

- *Counts.* For each word with an open count, each count from its fewest up to S + 1, where S is the bound of src/argv/readings.ts (`wordsBound`): past it, each more field lands in the same repeated operand, which adds no new kind of effect. Two words that are the same lone expansion get the same count (the ties of readings.ts, `ArgWord.param`).
- *Classes.* Bash's builtins read their options by getopt rules (`set` by a parser of its own with the same forms), which look at a field only through: whether it starts with `-` or `+` (where the builtin takes `+`), whether it is `-` or `--`, its letters up to one that takes a value, and the rest as that value. So a field where options are read has these classes: not an option; `-`; `--`; and an option word, whose known letters are read as written. Where the known start ends inside the letters, the next letter is each letter of the spec, or one the spec does not have, or the end of the field where the rest may be empty. A letter with a value takes the rest of the field as an abstract field (its `end` kept: `-v…\n` names no valid variable), or the next field where the rest may be empty. A field read as an operand stays abstract.
- *Names.* Each line is read by `builtinRead` with stand-in text for the abstract parts. Where the effect names a variable or function from an abstract field, the field's text decides it: known, a name bash refuses (by the rule above), or `?`.

The search stops at the first effect that is not E₀ when the question is "only E₀?" (shape first). It stops at the first `?` otherwise. It reads at most C lines (section 6); past them, the answer is "may change", which is sound.

**Can src/argv/readings.ts serve the count side?** In part. It gives the bound S for every spec a reading may visit, and the ties of one parameter; the design uses both. It cannot be the reader. Its shapes merge the words of a run because their text is not known (`x y` and `z` give the same argv), and each such word is read as `{}`, which `interpret` never takes as an option. The trust question needs what that merge loses: each field's start and end, and whether a field not known may be an option. So the reader enumerates its own lines (counts, then classes), with S and the ties from readings.ts.

### 2.5 Values at a place, and the facts of time and scope

V answers "what values can parameter p have where this word expands". A value is a known text, unset, or a hole of a kind. These are its facts:

- **V1. Written values.** A plain assignment of known text gives that text (`valuesWritten`). An integer variable does not store the text: `declare -i n; n=-v` gives `0` (F68). V1 relies on the allow-list here: the scan reads the values of integers as arithmetic (`integers` in src/semantics/trust.ts), and a text such as `-v` then reads a variable `v` the script never sets, so nothing is trusted.
- **V2. Unset.** `unset x` makes it unset, and so do `local x` and `declare x` with no value, where they make a new variable in the function's scope: an unquoted expansion of it then gives no field (F18). They do not make it unset where the variable keeps a value: with `shopt -s localvar_inherit` the local gets the value of the one it hides (F69); `local -I x` does the same (F70); a second `local x` or `declare x` in a scope where `x` is already local keeps its value (F71). There the value is the one before, from V1 to V5.
- **V3. The environment.** Where no write of the script may have run on some path before the place, the value may come from the environment: a `text` hole. bash sets some variables itself (`changedUnseen`: `REPLY`, `OPTARG`, `_`, `RANDOM`…): a `text` hole.
- **V4. Writes not followed.** `read`, `mapfile`, `select`, `printf -v`, `getopts`, a `for` loop (F42), `x=(…)`, `x[0]=`, `${x:=w}`, `x+=w`, `declare -l` and `-u`, a nameref or a nameref's target (F41): a `text` hole. A copy of a parameter of a known kind keeps it (`p=$!` is `digits`, maybe empty).
- **V5. Positional parameters.** The walk does not follow them: `$1`, `$@` and `$0` are holes.
- **V6. A write whose target is not known** (`read "$v"`, `${!r:=x}`: F23, a nameref whose target is not known) may give any variable any value. It stays a cause of "nothing is trusted" in the allow-list (trust-allow-list.md), as today. The rule does not bound it.

The scan has no flow: it asks V for the whole script (V1 ∪ V2, or a hole where V4 or V5 applies; a hole too for a variable the script never writes, which V3 then gives everywhere). It leaves out V3 elsewhere, which needs the place; the walk adds it. The walk asks V at the place: the state's value where it is set there on every path (a known text, or unset), a hole otherwise (`kept`, not set, or values that differ by path). Since the walk's values are the scan's values or holes, the walk's effects are checked against the scan's: every effect the walk allows must be one the scan read, or the walk walks again with nothing trusted (S5 today).

Two facts say *when* code runs and *which binding* a name has then:

- **T. Time.** A trap's action, an alias's text, and a function a callback runs (and the functions they call) run at a time of their own: at any point after the command that installs them. Their values are those of any such point: the whole script's (V1, V2, V4, V5), and the environment's (V3) for a variable that may not be set when they are installed. The walk already walks them from such a widened state (`widen`, where a variable not set there is `kept`).
- **S. Scope.** A local's value holds while its function runs; a prefix assignment's value holds while its command runs (manual 3.7.4). Code that runs later may see the global or the environment's binding of the same name. So in code that T covers, a name that is local in some function, or the name of some prefix assignment, is a `text` hole, whatever the state at the installing command says (F16, F17).

S belongs in `widen`: it is a fact about the state at a later time, for every reader of that state, not about deferred words.

The shell options also differ in such code. A trap's action sees the options of the function running then: `f() { local -; set -f; trap '…' RETURN; }` runs the action with `-f` on, which is off after `f` returns (F72). So the options a word expands with there (globbing, `set +B` with `set -E`, `noglob`) are not those of the installing command. `widen` (src/semantics/walk/widen.ts) makes each `set` and `shopt` option that some command changes after the installing one `unknown`, by the keys of those changes; this covers `local -`, `set -f`/`+f` and `set +B`. Step 5 checks it in bash.

### 2.6 How the scan and the walk use it

At a builtin with a word not known where it stands, the scan:

1. asks E with F of every such word, all parts holes (shape first). If only E₀: the builtin is read as written, and no plan is made;
2. otherwise asks E with the whole script's values (V1, V2, V4, V5). If an effect names `?`: nothing is trusted. Otherwise it applies each effect (as `readDeferred` reads each key today), and records the set for the walk.

The walk, where it runs a builtin the scan recorded a set for (also in code that T covers):

1. asks E with the values at the place (with V3, and with S in widened code);
2. walks again with nothing trusted if an effect is not in the scan's set.

Since a hole stands for every value, shape first is sound in every state. That is why the idioms need no plan, and no rule about traps, aliases, callbacks, locals or prefix assignments.

## 3. Soundness

### 3.1 The past counterexamples

Each is written out with the rule. "Not trusted" means the model decides nothing, as bash's behaviour requires.

- **`o='v u'; getopts -- $o`** (S10). Shape: `--`, then `$o` unquoted, a `text` hole with an open count. At count 2 the line is `getopts -- F1 F2`: F1 is the option string and F2 the name, any text: it may be a name, `?`. So shape first fails. Values: `o` is `v u` or unset; `v u` gives `getopts -- v u`, which sets `u` (F8). The scan applies "sets `u`". Right.
- **`x=; printf "\<newline>-v$x" u 2`** (S11). The word model removes `\<newline>` in double quotes (F7): one field, start `-v`, then a quoted `text` hole. Class: option `-v`; its value is the rest, which may be empty, so it may be the next field `u`: "sets `u`". Shape first fails. Values: `x` is empty: `printf -v u 2`, "sets `u`". Right. Had `x` been a hole, the rest could be `-vNAME`: `?`, nothing trusted.
- **`f() { local m=hi; trap 'printf $m u 2' ERR; }; m=-v; f; false`** (S13). Shape: `$m` unquoted, may be `-v`: shape first fails. The action runs at a time of its own (T), and `m` is local in `f` (S): `m` is a `text` hole there. `-vNAME` gives `?`: nothing trusted. bash sets `u` (F16). Right.
- **`g() { trap 'printf $m u 2' ERR; }; m=hi g; false`, `m=-v` in the environment** (S14). As above: `m` is a prefix assignment's name, so a hole under T and S. Nothing trusted. bash sets `u` (F17). Right.
- **`x=-v; unset x; printf $x u 2`** (S3). Shape first fails (`$x` may be `-v`). Scan values: `-v` or unset: effects "sets `u`" and nothing. The walk, at the place: `x` is unset (V2), so `$x` gives no field (F18): `printf u 2`, nothing, which is in the scan's set. Trusted, and right.
- **`x` from `read`, `for`, `mapfile`, `printf -v`, a nameref, `OPTARG`, `REPLY`** (S2). V4 makes `x` a hole. `printf $x u 2`: `-vNAME` gives `?`: nothing trusted. bash: `read x <<< -v`, `for x in -v`, … set `u` (F41, F42 and #501's tests). Right. `printf "$x\n"` with the same `x`: one field, ending in `\n`; every class sets nothing (section 4). Trusted, and right.
- **An IFS the script sets** (S6). Where the IFS is not known, an unquoted known part becomes a `text` hole (2.3, item 4). `IFS=v; x=-vu; printf $x 2`: a hole, may be `-vNAME`: nothing trusted (bash gives `printf - u 2`: F19). Literal text and quoted parts do not split, so `printf "$line\n"` stays trusted with any IFS.
- **POSIX mode, `command declare a=$v`** (S7). The mode is a fact of the state; where it is not known, both are read. Not POSIX: `a=$v` is a word and splits, so `v='x b=1'` declares `b` (F22). POSIX: one assignment (F21). The union has "declares `b`", so the scan applies it. Right in both modes.
- **`${!r:=x}`** (V6). An expansion that assigns a variable whose name is not known (F23) is not bounded by the rule. It stays a cause of "nothing is trusted" in the allow-list. Right, as today.
- **`printf $x u 2; x=a`, `x=-v` in the environment** (S4). The scan's values are `a` and unset; neither sets anything. At the place, `x` is not set on any path yet, so V3 makes it a hole. `-vNAME` gives `?`, which is not in the scan's set: the walk walks again with nothing trusted. Right.
- **Past the readings** (S8). Past K tuples, the remaining parts become holes. A hole is sound; it only loses precision.
- **A reading that sets a variable the words read** (S15). The scan's values of that variable must include what the reading writes. This stays a check, now stated as part of V1: the values written include those the deferred builtins write.

### 3.2 What it still assumes

- **A1.** A pattern written in the script's own text, with no expansion, matches no file (`declare a[1]`, as today). Fields of an expansion no longer need it (2.3, item 5).
- **A2.** The environment does not change bash itself: no exported functions named like builtins, no `BASH_ENV`, no `SHELLOPTS` (trust-per-position.md, section 2; as today).
- **A3.** The status of a builtin is not part of its effect. A refused reading changes the status (1 or 2). The status model (src/semantics/status.ts) gives the builtins of this page no known status (their rule is `command`), so no condition rests on it. One exception is left as it is: a declaration with a `$( )` is `masked`, taken to give its own status, which a refused name makes 1 (F9, F12); the roadmap lists the statuses of the declarations as read from the words as written.
- **A4.** The spec's option letters and operands are those of bash 5.2 (and 5.3 where `bashVersion` says so). Step 2's test checks them against bash.
- **A5.** Writes made while the builtin's own words expand are not part of its effect, and the rule does not see them: `x='a[y=5]'; : "${!x}"` and `x='y=5'; : "${a[$x]}"` set `y`. They are safe only because the allow-list makes such words a cause of "nothing is trusted" (an indirection, arithmetic that reads text not known), as today.

### 3.3 Facts checked in bash 5.2

| # | Snippet | bash 5.2 |
| --- | --- | --- |
| F1 | `x='-vu'; printf "$x\n"` | "`u\n`: not a valid identifier", status 2, `u` unset |
| F2 | `printf -v 'u\n' %s 1` | the same |
| F3 | `printf -vu`; `printf -v u` | usage, status 2, `u` unset |
| F4 | `printf --`; `printf -` | usage, status 2; prints `-`, status 0 |
| F5 | `printf -Xvu 2` | "-X: invalid option", status 2, `u` unset |
| F6 | `printf -v 'a[y=5]' %s 1` | status 0, `y` is 5 |
| F7 | `x=; printf "\<newline>-v$x" u 2` | `u` is 2 |
| F8 | `o='v u'; set -- -v; getopts -- $o` | `u` is `v` |
| F9 | `declare 'a\n' b=1` | an error for `a\n`, status 1, `b` is 1 |
| F10 | `declare -Z c=1` | invalid option, status 2, `c` unset |
| F11 | `read 'a\n' b <<< 'p q'` | status 1, `b` unset |
| F12 | `export 'a\n' e=1`; `local 'a\n' l=1` | status 1, `e` and `l` are 1 |
| F13 | `z=1; unset 'a\n' z` | status 0, `z` unset |
| F14 | `mapfile 'a\n' <<< x` | "not a valid identifier", status 1 |
| F15 | `getopts a 'n\n'` | "not a valid identifier", status 1 |
| F16 | `f() { local m=hi; trap 'printf $m u 2' ERR; }; m=-v; f; false` | `u` is 2 |
| F17 | `g() { trap 'printf $m u 2' ERR; }; export m=-v; m=hi g; false` | `u` is 2 |
| F18 | `x=-v; unset x; printf $x u 2` | prints `u`, `u` unset |
| F19 | `IFS=v; x=-vu; printf $x 2` | prints `-`, `u` unset |
| F20 | `IFS=:; x=':'; set -- $x`; `x='a::b'; set -- $x` | 1 field; 3 fields |
| F21 | `set -o posix; v='x b=1'; command declare a=$v` | `a` is `x b=1`, `b` unset |
| F22 | `v='x b=1'; command declare a=$v` | `a` is `x`, `b` is 1 |
| F23 | `r=a; : "${!r:=x}"` | `a` is `x` |
| F29 | `declare - b=1` | "`-`: not a valid identifier", `b` is 1 |
| F30 | `declare b=1 -i c=2+3` | "`-i`: not a valid identifier", `c` is `2+3` |
| F31 | `printf $((-5))` | "-5: invalid option", status 2 |
| F34 | `touch ./-vu; x='*'; printf $x 2` | `u` is 2 |
| F35 | `f='-vu 2'; printf "$f"` | "`u 2`: not a valid identifier", `u` unset |
| F36 | `set -eZ` | status 2, `-e` not on |
| F40 | `x='a='; declare "$x\n"` | `a` is `\n` |
| F41 | `declare -n r=x; x=-v; printf $r u 2` | `u` is 2 |
| F42 | `for o in -e -u; do :; done` | `o` is `-u` after the loop |
| F43 | `IFS=-; x=a-b; set -- "c-"$x"-d"` | 2 fields, `c-a` and `b-d` |
| F44 | `set -- u 2; printf "-v$@"` | `u` is 2 |
| F46 | `x='a[y=7'; printf -v "$x]" %s 1` | `y` is 7 |
| F50 | `y=1; x='[y=5]=1'; declare -a "arr=($x)"` | `y` is 5 |
| F57 | `y=1; declare -a 'arr=($((y=5)))'` | `y` is 5, `arr` is `5` |

| F61 | `y=1; declare -A 'arr=([k]=$((y=5)))'` | `y` is 5 |
| F62 | `printf $! -vu 2` (no `&` before) | `u` is 2 |
| F63 | `touch ./-vu; x='\-v*'; printf $x 2` | `u` is 2 |
| F64 | `touch ./-vu; shopt -s nocaseglob; x='-V*'; printf $x 2` | `u` is 2 |
| F65 | `touch ./-vu; shopt -s extglob; x='!(zz)'; printf $x 2` | `u` is 2 |
| F66 | `f.(){ :; }; x=f; export -f "$x."; declare -fr "$x."` | both status 0; `declare -F` shows `declare -frx f.` |
| F67 | `a=1; declare 'a+=2'` | `a` is `12` |
| F68 | `declare -i n; n=-v` | `n` is 0 |
| F69 | `shopt -s localvar_inherit; x=-v; f(){ local x; printf $x u 2; }; f` | `u` is 2 |
| F70 | `x=-v; f(){ local -I x; printf $x u 2; }; f` | `u` is 2 |
| F71 | `f(){ local x=-v; local x; printf $x u 2; }; f`, and the same with `declare x` | `u` is 2 |
| F72 | `f() { local -; set -f; trap 'echo "$-"' RETURN; }; f; echo "$-"` | the action prints `f` among the flags; after `f`, no `f` |
| F73 | `unset x; printf '<%s>' ${x-a b}$!` (no `&` before); `${x-a b}$!$e` with `e` empty; `${x-a b}${!}` | `<a b>`; `<a><b>`; `<a><b>` |
| F74 | `n() { echo $#; }; set --; x=; n "$@$x"; n "$x$@"; n "$@""$x"; n "$@"""` | `0`, `0`, `1`, `1` |
| F75 | `IFS=1; set -- a; printf '<%s>' "$@$#" "$@$((1))" "$@$x"` with `x=1` | `<a>` `<a>` `<a1>` |
| F76 | `touch './\-vu'; set -- '\'; printf '<%s>' $1"*"` | `<\-vu>` |
| F77 | `touch ./a; x='\a'; printf '<%s>' $x` | `<\a>` |
| F78 | `n() { echo $#; }; shopt -s nullglob; n ~*` | `0` |
| F79 | `n() { printf '<%s>' "$@"; echo " $#"; }; set -- a; n ${#:+-v}; n ${#/#/-}; n ${##1}; n ${#@Q}` | `<-v> 1`, `<-1> 1`, `<> 0`, `<'1'> 1` |
| F80 | `x=hi; : ${x@Z}`; `: ${#^^}`; `set --; : ${1:=a}`; `readonly x; : ${x:=a}` | each fails: bad substitution, bad substitution, cannot assign in this way, readonly variable |
| F81 | `touch ab xb '*x'; IFS='*'; printf '<%s>' '*'* '*'x` | `<*x><ab><xb>` `<*x>`: the quoted `*` is globbed |
| F82 | `IFS=:; x=a:b; set -- p; printf '<%s>' "$@${x:+a:b 1}"` | `<pa><b 1>` |
| F84 | `IFS=-; set --; printf '<%s>' "$((-1))$@"; echo; set -- a; printf '<%s>' "$((-1))$@" "${x#}$@"` with `x=-1` | `<><1>`; `<><1a><-1a>` |
| F83 | `IFS='\'; set -- a; printf '<%s>' "$@\n"; echo; printf '<%s>' "x\n"` | `<a><n>`; `<x\n>` |
| F85 | `printf '<%s>' ${!z@} "${!BASH_VERS@}"`; `x=hi; : ${x@}`; `unset x; : ${!x@Q}` | `<BASH_VERSINFO><BASH_VERSION>`; bad substitution; invalid indirect expansion |
| F86 | Outside a function: `( : ${FUNCNAME:=a}; echo ok )`, the same with `BASH_ARGV`; `: $((BASH_LINENO=1))`, also `BASH_SOURCE`, `BASH_ARGC`, `GROUPS`, `FUNCNAME`; `: ${x[@]:=a}`; `declare -i i; : ${i:=a b}` | each fails: the first two with no message, status 2; status 1; bad array subscript; syntax error in expression |
| F87 | `x=a; z=bcd; printf '<%s>' ${z:x=1}$x`; the same with `${z[x=2]}$x`; with `${z:0:x=2}$x` | `<cd1>`; `<2>`; `<bc2>` |
| F88 | `unset IFS; x='a:b c'; printf '<%s>' ${IFS=:}$x`, also with `${IFS:=:}`; `set -f; unset IFS; x='a b'; printf '<%s>' $x$((IFS=1))` | `<><a><b c>`; `<a b>`: bash splits the whole word by the IFS it has after its expansions |
| F89 | With `x=a1b`: `y='IFS=1'` and `$x$((y))`; `y='a[IFS=1]'` and `$x${!y}`; `declare -n r='a[IFS=1]'` and `$x$r`; `y='$((IFS=1))'` and `$x${y@P}`; `declare -i i` and `$x${i:=IFS=1}`; `unset IFS; y=IFS` and `$x${!y=1}`. But `y='a[${IFS:=*}0]'; : $((y))` | `<a><b>` each; IFS stays as it was: a value read as arithmetic runs only arithmetic, which assigns integers |
| F90 | `a=~\<newline>/x; echo "$a"`; `printf '<%s>' a=~\<newline>/x x=a:~\<newline>/x`; `set -- q r; printf '<%s>' $\<newline>@ $\<newline># $\<newline>((1+1)) $\<newline>'a'` | `$HOME/x`; `<a=$HOME/x><x=a:$HOME/x>`; `<q><r><2><2><a>` |
| F91 | `printf '<%s>' {Z..a..+2} {a..e..+2}` | `<Z><><^><`><a><c><e>`: a step may have a `+`; the `\` of the range is removed |
| F92 | With extglob on where bash parses the line: `x='a b'; printf '<%s>' x@(${x})y`; `set -f; printf '<%s>' +($x)`; `touch ab; printf '<%s>' @(a'\|'b)`, then `touch 'a\|b'` and again | `<x@(a><b)y>`; `<+(a><b)>`; `<@(a\|b)>`, then `<a\|b>`: the quoted `\|` is no alternative, the pattern is `@(a\\|b)` |
| F93 | bash 5.3: `x=a1b; printf '<%s>' $x${ IFS=1; }` | `<a><b>` (bash 5.2: bad substitution) |
| F94 | `shopt -s globstar; mkdir -p d/e; touch x d/x d/e/x; printf '<%s>' d/**/x; echo; printf '<%s>' **/x` | `<d/e/x><d/x>`; `<d/e/x><d/x><x>`: `**/` may match nothing, its `/` too |
| F95 | `printf '<%s>' a1b$((IFS=1))`; `$((IFS=1))a1b`; `{1..3}x${u:-$((IFS=1))}` | `<a><b>`; `<><a1b>`; `<><x><2x><3x>`: bash quotes the characters of the word's text that IFS holds as it expands them, so text before the assignment splits |
| F96 | `touch ab; IFS='*'; unset x; printf '<%s>' *b$x; echo; printf '<%s>' *\b` | `<*b>`; `<ab>`: in a word that expands something, a character of its text that IFS holds is quoted |
| F97 | `set -- a; IFS=1; printf '<%s>' "$#$@"`; `IFS=0; set --; printf '<%s>' "$#$@"`; `x=1; IFS=1; printf '<%s>' "${#x}$@"`; with `IFS=1` and one element, `"$?$@"` after `false`, `"$$$@"` and `"$!$@"` with `IFS=0123456789`, `"${#:-1}$@"`, `"${#a[@]}$@"`, `"$#${a[@]/z/y}"`, `"$#${!BASH_V@}"`, `"$#a$@"`, `"${y:-$#}$@"`; but `"$x$@"` with `x=1`, `"$(echo 1)$@"`, `"$#""$@"`, `"$LINENO$@"` | `<><a>`; `<>`; `<><a>`; each split by IFS likewise; `<1a>` each, not split: a part made from an integer before `"$@"` in the same quotes is split, as `$(( ))` (F84) |
| F98 | `printf '<%s>' {1..\<newline>3}`; `shopt -s extglob; touch a; printf '<%s>' @\<newline>(a)` | `<1><2><3>`; `<a>`: a line continuation goes before brace expansion and globbing |
| F99 | `printf '<%s>' {0..2..9223372036854775808} {1..2..18446744073709551617} {a..c..9223372036854775808} {9007199254740993..9007199254740991..2}` | the first three as they are; `<9007199254740993><9007199254740991>`: past intmax_t a sequence is not expanded, and below it bash counts exactly where a double does not |
| F100 | With `HOME=/H`: `cat <<< x:~`, `cat <<< x=~`; `r=([0]=~ [1]=a:~); printf '<%s>' "${r[@]}"`; `unset x; a=${x:-x:~}`, the same with `declare`, `local`, `export`, `alias q=…`, `cat <<< ${x:-x:~}`; but `printf '<%s>' a=${x:-x:~}`, `r=([0]=${x:-x:~})` | `x:/H`, `x=~`; `</H><a:/H>`; `x:/H` each; `<a=x:~>`, `x:~` |

F85 to F100 were checked with bash 5.2 and 5.3 (`$BASH_EXPLAINER_BASH53`); each gives the same, but F93 (and `declare -A m=([k]=~)`, `~` in bash 5.2 and `/H` in 5.3).

Also checked, for step 0: `declare -a arr="($x)"`, `declare -a 'arr=([y=5]=1)'` and `local -a 'arr=([y=5]=1)'` set `y` to 5. `-A` reads the text again too: its keys are not arithmetic (`declare -A 'arr=([y=5]=1)'` leaves `y`), but its values are expanded (F61). Without `-a` or `-A`, the text is read again where the name is already an array: `arr=(); declare "arr=([y=5]=1)"` sets `y`; `declare "arr=($x)"` with no array `arr`, and a new local in a function (`f() { local "arr=([y=5]=1)"; }`), leave it. An unquoted value is read so too: `x='([y=5]=1)'; declare -a arr=$x` sets `y`. `export -a` and `readonly -a` do the same. `x='$(y=7)'; declare -a "arr=($x)"` runs the substitution, in a subshell.

## 4. Expected gains

### 4.1 The idioms

Each line of section 1.3, by shape first (2.1). None needs values, time or scope.

| Line | Shape | Why only E₀ |
| --- | --- | --- |
| `printf "${RED}err${NC}\n"` | one field, end `\n` | `printf` with one field has no format after any option: refused (F3, F4, F35) |
| `printf "${BOLD}Title${RESET}\n"` | one field | as above |
| `printf "$line\n"` | one field | as above |
| `printf "$msg\n"`, `printf "${1:-default}\n"`, `printf "$1\n"` | one field | as above |
| `printf "$(date +%F) msg\n"` | one field | as above |
| `printf "$f\n"` (in `for f in *`) | one field | as above |
| `printf "$f"` | one field | as above |
| `printf "$pad%s\n" a` | two fields, the first ending in `\n` | the first is no `--`; as `-v…`, its value ends in `\n`, no name (F27 below); any other letter is refused; as the format, it sets nothing |
| `printf " sudo apt-get install ${pkgs# }\n"` | one field, start ` ` | not an option |
| `mapfile -tO ${#a[@]} a` | `digits`, one field | not an option; the value of `-O` names nothing |
| `declare -F _k_${func}` | first field starts with `_` | not an option, so every later field is an operand (F30); `-F` only prints the functions it names |
| `declare -a "arr=($x)"` | one field, `arr=(…)` | **not gained**: bash reads the text again as code (F50); the effect "runs text", of text not known, is `?` |

(F27: `pad=-v; printf "$pad%s\n" a` gives "`%s\n`: not a valid identifier", status 2.)

### 4.2 Measured

Measured at c8b042c3 with a counter of the model over three sets, read as data and never run: the snippets of test/fixtures/snippets.json (1,861); `scripts(1, 1000)` of test/support/decisions.ts; and 1,076 real scripts of this machine (896 files of /usr/share/bash-completion/completions, and 180 files of /usr/bin, /usr/sbin and /etc whose first line names sh or bash). To see what other causes hide, the counter also ran with the scan going on past its first reason, and listed every plan that is not `written`.

| | Snippets | `scripts(1, 1000)` | Real scripts |
| --- | --- | --- | --- |
| Inputs that trust nothing | 260 | 666 | 931 |
| … for a builtin's word (a deferred word, or a name not known) | 3 | 6 | 5 |
| … of which shape first decides | 1 (`printf "$f"`) | 0 | 0 |
| Inputs with a plan that is not `written` (any other causes) | 4 | 569 | 14 |
| Such plans | 4 | 673 | 20 |
| … that shape first decides | 1 | 0 | 9 |

The other two snippets, and the five real scripts, give a builtin a variable name not known (`read -r "$v"`, `unset {a,$v}b`) and stay. The six generated scripts give `set $o`, `declare $od` or `printf $op …` an unquoted word whose values come from `read`, `for` or a pipeline: an option place, so shape first cannot decide them; whether values decide them is measured in step 4. The nine real plans are `printf "$SSH_CONNECTION"` (2), `printf "$2"` (2), `printf "$panes\n$layout\n"`, `printf " sudo apt-get install ${pkgs# }\n"` (2), `mapfile -tO ${#cvsroots[@]} cvsroots` and `declare -F _kmod_${func}`. The other eleven stay: `complete -F $fname` (4), `export PATH \`envsubst …\`` (4), `set $FILES`, `set "$0" "$@"`, and `wait $xprop_pid`, whose value comes from `grep`.

So the gain in whole inputs is one snippet. Every real script with such a plan trusts nothing for other reasons (most of bash-completion for `compgen`, the rest for a `source`, an `eval` or a command name not known). The idioms of section 1.3 come back where nothing else hides them: in a user's own script, which is what the explainer reads.

The gain that does not show as a count: the special cases S9 to S14 go away (section 5), and each past counterexample comes out of one rule and five stated facts.

## 5. Steps

Each step is a PR that keeps every test passing, test/decisions.test.ts against bash included, and leaves the snapshot of the corpus byte-identical unless the step says what changes.

0. **Fix: the text of a compound assignment given to a declaration is read again as code.** Done in #504. Independent of the rule, and first. `declare -a 'arr=([y=5]=1)'` and `declare -a "arr=($x)"` set `y` (F50, F57); the model decides `[ "$y" = 1 ]` true on main. The cases (section 3.3, after the table): `-a`, and `-A` for its values (F61); without either, where the name is already an array; a value that is not the word's own syntax, quoted or from an expansion (`declare -a arr=$x`); `declare`, `local`, `typeset`, `export -a`, `readonly -a`. Not for a new local with no `-a`. The scan reads that text as an array assignment (arithmetic subscripts, expansions), and a text not known there trusts nothing. Checked by rows in test/decisions.test.ts, run in bash. A CHANGELOG line (a fix). As done: the scan does not know which variable is an array where, so it reads a value known so with or without `-a`. A value not known trusts nothing with `-a` or `-A`, and else where the variable may be an array somewhere in the script: a write that is not scalar, a nameref's target, or one of bash's arrays. A new local (`arr=(); f() { local 'arr=(…)'; }`) is read so too, which bash does not do. That trusts less, never wrongly. The corpus loses nothing (`Write.scalar`, `compoundReads`). The existing bullet of the CHANGELOG covers the fix; the example is in docs/changes/unreleased.md.
1. **The field domain** (src/semantics/fieldshape.ts). `wordShapes(word, state, values)`: the shapes of section 2.2, computed as 2.3 says, and the four questions on a field. Nothing reads it yet. Its test (test/fieldshape.test.ts) is differential and generated: words with literal starts and ends, quoted and unquoted holes of each kind, braces, `\<newline>`, `$"…"`; states with the default IFS, a blank and a non-blank IFS, `nullglob`, `nocaseglob`, `extglob`, `set +B`, POSIX mode; random values for the holes, with backslashes and glob characters; `$!` before and after a `&`; and files on disk that the patterns match (`-vu`, `-Vu`, names with `\`). Each runs in bash (in a cgroup, `FUNCNEST` set, killed as a process group) and prints its fields. The test checks that bash's fields lie in the union of shapes, and that the questions answered "no" hold for each of them. This is the foundation: it is reviewed alone before step 2 builds on it, once the facts F62 to F66 are in its domain and its generator. **Done** (2026-10-30): test/fieldshape.test.ts, its generator in test/support/fieldshape-gen.ts. Each generated case is a script the model reads, run by bash in a subshell after lines the model does not see (the environment, `set --`, an array, a background job), so that what they set is a hole; the options are on, off, as they start, or set where a variable of the environment says. CI runs 400 cases (seed 20261030). Each case also runs with `set -f` before the word, so the fields before pathname expansion (`glob: false`) are checked too, and so is `mayGiveNone`. After the review of #506 the generator also makes `${#` with operators, `:=`, read-only variables, namerefs, names bash sets, IFS values with `\\`, glob characters and `\v`, and the words the domain refuses. 60,000 cases on three seeds found no field outside its description; before the review, 120,000 cases on six seeds of the smaller generator. Precision on 20,000 cases of the larger generator: about 15 % are refused (section 7); the count is exact in about 34 % with every part a hole; with the values the case assigns where the model sees them, the description is bash's fields themselves in about 26 % (the others read parameters the model cannot see, or globs). The generator and the review found facts F73 to F84 and the words the domain refuses (section 7). A second review of #506 found F85 to F93, and a search of their neighbours F94 to F96. After it, the generator also makes extglob groups with quotes and expansions in them (such a case starts with extglob on, where bash parses it), `$` and tildes before line continuations, steps with `+`, words that assign IFS or other variables by `=` or arithmetic (in subscripts, offsets, values read as expressions), indirections and name listings (`${!x}`, `${!x@}`), `:=` on what bash keeps, `-i` variables, operators the evaluator computes, more brace forms, and globstar with directories. Each case whose fields the domain knows in full before pathname expansion, one of them a pattern, also runs each pattern alone in bash with nullglob: bash's fields must be the names it matches, or the field itself or nothing where it matches none. 80,000 cases on four seeds found no field outside its description and no pattern that matches otherwise than bash; about 29 % are refused (the generator makes many of the words section 7 lists), the count is exact in about 24 % with every part a hole, and with the values, the description is bash's fields in about 18 %. The final review of #506 found F97 to F100; the generator then also makes parts made from an integer before elements in the same quotes, IFS values of digits, line continuations in braces and groups, and sequences with long numbers (and no longer `**` under a path that may start at `/`). 80,000 cases on four seeds found no field outside its description; about 32 % are refused, the count is exact in about 19 % with every part a hole, and with the values, the description is bash's fields in about 14 %.
2. **The question to the spec reader** (src/argv/fieldreadings.ts). `builtinEffects(name, spec, line, values)`: the effect of 2.4, the refusal rules (a field of `OperandSpec` for a name bash refuses, with a row per builtin), the counts with S and the ties of readings.ts, the classes, the early stop and the cap C. Nothing in the trust reads it yet. Its test is differential too: for each builtin the scan defers (`set`, the declarations, `printf`, `read`, `getopts`, `mapfile`, `wait`, `complete`…), random lines of known text are run in bash, and the state before and after is compared: variables and their attributes (`declare -p`), functions, exported and readonly ones (`declare -F`, `declare -f`, and the `-fx` and `-fr` listings), `set -o`, `shopt`, and traps (`trap -p`); bash's change must be one of the effects the reader gives for any shape that holds the line. The facts of section 3.3 become rows.
3. **Shape first.** The scan and the walk ask step 2 with every part a hole before anything else; a word whose shape allows only E₀ gets no plan. `inert`, `inertAfter`, `literalStart` and `expands` go (S9, S10, S11). Checked: every row of the past counterexamples in test/decisions.test.ts stays undecided; the idioms of section 1.3 get rows that are decided, each run in bash; the generator (case 38) gets words with a literal start or end around a value not known (`printf "$y\n"`, `printf "-v$y" u 2`, `printf "$y%s\n" a`, `getopts -- $o`). `mayGiveNoField` (src/semantics/nofield.ts) and `wordPatterns` (src/semantics/globwords.ts) become views of fieldshape.ts, so each fact of a word's fields has one source; their tests stay as they are. Measured on the three sets; the snapshot changes only where an input gains its trust.
4. **Values as holes.** `valuesWritten` gives known texts or a hole with a kind; `fieldReadings` enumerates the known parts and makes holes of the rest; past K tuples, parts become holes instead of the words being read as written; an IFS not known makes unquoted known parts holes. The plan holds the scan's effects, and the walk's check is "its effects are in the scan's" (S2, S4, S5, S6, S8; S1 and S3 stay as V1 and V2). Checked by test/decisions.test.ts and the generator; the comment at `fieldReadings` on POSIX mode is corrected (S7). Measured on the three sets.
5. **Time and scope in `widen`.** In code that runs at a time of its own, a name that is local in some function, or the name of some prefix assignment, is a hole (S); the walk then checks such code like any other, and the scan's `late` check goes (S12, S13, S14). Checked by the trap, alias and callback rows of test/decisions.test.ts, and new generator cases: a trap set in a function with a local, and in a function called with a prefix assignment, each run in bash.
6. **Documents.** trust-allow-list.md, section 6, points here for deferred words; the roadmap item moves to "Done lately"; README Limitations states A1 as it now stands.

## 6. Costs and caps

- **K, the tuples of known values** enumerated for one builtin: 16, as `READINGS` today. Past K, parts become holes. This loses precision, never soundness.
- **C, the lines read** for one builtin: 1,024, as `SHAPE_CAP` in readings.ts. A line is one `builtinRead`, about 0.03 ms (count-hedges.md, 2.8). Past C, the answer is "may change".
- **`set` with a hole.** `set` names no variable, so its effects never hold `?`, and the search after shape first does not stop early: `set $x` with `x` a hole enumerates clusters of its letters up to C. Past C, nothing is trusted, as today ("`set` is given a word not known before its operands").
- **The common case is small.** A `printf` with one quoted field reads five classes (not an option, `-`, `--`, `-v` with the rest, a letter it does not have). A `declare $x` stops at its first class that sets an attribute. Shape first needs no values, so most builtins are read once per text: the cache of `deferredReadings` (by text, shell, POSIX mode and IFS) stays, keyed by the shapes.
- **Counts.** A word with an open count is read at its fewest up to S + 1; with ties, fewer. For the builtins read so, S is 4 to 6 (`declare`, `read`, `mapfile`: 4; `printf`, `set`: 5; `getopts`: 6).
- #501 measured 1,500 lines of `printf "%s …" "$a" … "$f"` at about 0.55 s for the model. Step 3 measures the same file, and one of 1,500 `printf "$x\n"` lines, which reads every line today.

## 7. Known limits

- A pattern of the script's own text matches no file (A1): `declare a[1]` is read as declaring `a[1]`.
- A name not known stays a cause of "nothing is trusted": `read "$v"`, `printf -v "$v"`, `complete -F $f`, `unset {a,$v}b`.
- `$"…"` is a hole: a translation may start with `-`. `printf $"Copyright %s $y" 2024` stays not trusted.
- Words the word model or the parser reads otherwise than bash, found by step 1's generator and its review. `wordShapes` says it does not know them (undefined), so nothing is decided from them; each is to be fixed in the word model or the parser in a PR of its own, and the refusal then goes. A line continuation after a tilde prefix, also after `=` or `:` (`~\<newline>` is `~`, `a=~\<newline>/x` is `a=$HOME/x`: F90), after a `$` (`$\<newline>@` is `$@`) or in a parameter's name (`"$y\<newline>a"` is `"$ya"`). `$_` before a brace expression (`$_{a,b}` gives `$_a` and `$_b`). A process substitution joined to other text (with an expansion in the word, bash splits its name: `<(:)$x` with `IFS=/` gives four fields), also across a line continuation (`<(:)\<newline>$x`). A brace expression right after `$$` (bash does not expand `$${1..2}`; `$$${x}` is read). A range of characters across the backslash (`{Z..a}`, also with a step, `{Z..a..+2}`: F91). Text the adapter keeps as plain with a quote or an expansion in it, as in an extglob group (`x@(${x})y` is split, `@(a'|'b)` is the pattern `@(a\|b)`: F92). A `${ cmd; }` of bash 5.3, which runs in the shell and may set IFS (F93). A word that may assign IFS other than by arithmetic (`${IFS=:}$x`, an indirection or a nameref with `=` or `:=`, `${x@P}`, an expansion with `=` the reader does not parse, `${!y=1}`: F88, F89). An IFS with a control character but tab and newline (`$'\v'`). An IFS that holds (or may hold) a glob character, unless `set -f` is on, where the word has a quoted glob character it holds or a quoted part not known, even with no glob character of its own (F81), or where a value has a backslash. An IFS that holds (or may hold) `\\`, where the word has `"$@"` and a quoted backslash or a quoted part not known (F83). Found by the final review of #506: any line continuation not in quotes or a substitution (`{1..\<newline>3}`, `@\<newline>(a)`: F98); a sequence expression with a number of 16 digits or more (F99); a tilde that bash expands and the word model does not, after `:` in a here-string (`<<< x:~`), in an element `[k]=…` of an array, and in the operand of an expansion in an assignment (`a=${x:+x:~}`, also given to `declare`, `local`, `export`, `alias`: F100).
- A `for` loop's values are a hole even over known words (F42); listing them is left.
- `unset`, `shopt` and `enable` are still read as written (S17); the rule could read them later.
- Where the walk's values differ from path to path, it reads a hole rather than each path's value.
- `cannotFail` (src/semantics/status.ts) says that `printf` of words with no `$( )` cannot fail; `printf $((-5))` fails (F31). It feeds a note on pipelines, not a decision (A3), and is left.
- The effects of a builtin in bash 5.3 that differ from 5.2 are read from the spec of that version; step 2's test runs bash 5.3 (`$BASH_EXPLAINER_BASH53`) where it is set.

## 8. For the maintainer

- The gain counted in whole inputs is small: one snippet of 1,861, none of the generated or real scripts (section 4.2). The idioms are gained where nothing else hides them.
- The case for the rule is soundness that can be reviewed in one place. Each of #501's review rounds found a hole in a special case; under the rule, each past case follows from F, E, the values V1 to V6, or the facts T and S (section 3.1).
- Step 0 is a wrong decision on main today, independent of the rule. Another PR fixes it.
- The review of this page found more holes in the domain (F62 to F66, F69 to F71). None makes main decide wrongly at c8b042c3: `localvar_inherit` trusts nothing (allow-list); `local -I x`, `printf $! -vu 2` and `p=$!; printf $p -vu 2` trust nothing (a plan the walk cannot check); a second `local x` or `declare x` keeps the trust and decides nothing.
- Steps 1 and 2 are the foundation, and are tested against bash on their own. Step 3 gains the idioms and removes S9 to S11. Steps 4 and 5 remove the rest of the special cases, and gain little by themselves.
