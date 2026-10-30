# Trust of a builtin's words, from what their fields may be

Status: planned (2026-10-30). The maintainer approved a redesign: "a design document first, then steps that keep every test passing". No step is started. The roadmap item is under "Next" in [../roadmap.md](../roadmap.md).

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

`declare -a "arr=($x)"` is different: main before #501 decided it wrongly. bash reads a quoted compound assignment given to `declare -a` again, as code: `x='[y=5]=1'; declare -a "arr=($x)"` sets `y` to 5 (3.3, F50). The same happens with static text, and the model decides it wrongly on main today (section 5, step 0).

## 2. The model

### 2.1 Three questions and one rule

A builtin's effect depends on three things. The design keeps them apart:

- **F, the fields.** What can the fields of this word be, given what each of its parts may be? This is a question about the word and the shell options where it expands (braces, IFS, globbing, POSIX mode). It does not ask where a value comes from.
- **V, the values.** What values can this parameter have where the word expands? This is a question about the script: its writes, their scope, and when the code runs.
- **E, the effect.** Given such fields, what can the builtin change? This is a question for the builtin's spec reader (src/argv/).

**The rule.** Let E₀ be the effect the model gives the builtin (as written, or from the fields it knows). The model may trust a builtin's words when every effect that E allows for the fields that F allows, with the values that V allows, is E₀. Otherwise the effects it allows must all be known (no name not known), and the model applies each of them as one that may happen; where some effect names a variable not known, nothing is trusted.

**Shape first.** F is first asked with every part not known (no values at all). If the word's shape alone allows only E₀, nothing more is needed: no values, no plan for the walk, and nothing about time or scope. This is how the idioms of section 1.3 are decided (section 4). V, and the facts of time and scope, are needed only for a word whose shape alone may change the effect (`set $x`, `declare $x`, `printf $x u 2`, `getopts -- $o`).

### 2.2 The field domain

A part of a word is either known (a text, or unset) or a **hole**. A hole has a kind and is quoted or not:

| Kind | What it may give | From |
| --- | --- | --- |
| `text` | any text, also empty | a value not known, `$( )`, `$1`, `$0`, a tilde, `$"…"` |
| `digits` | one or more digits | `$#`, `$?`, `$$`, `$!`, `${#x}`, `${#a[@]}` |
| `integer` | digits, maybe after a `-` | `$(( ))` (F31: `printf $((-5))` is an invalid option) |
| `elements` | no field, or any number of fields of any text | `"$@"`, `"${a[@]}"` |

A field is described by:

```ts
interface Field {
  text?: string;   // known in full
  start: string;   // its known literal start: the text before its first hole
  end: string;     // its known literal end: the text after its last hole
  head?: Hole;     // the hole it starts with, where `start` is empty (its kind bounds the first character)
  tail?: Hole;     // the hole it ends with, where `end` is empty
}
```

Where `text` is undefined, the field is any text that starts with `start`, ends with `end`, and is at least as long as both together. The text between is not kept.

A word gives a list of **shapes**, one for each word of its brace expansion, in order. A shape is a count and fields:

```ts
type Shape =
  | { fields: Field[] }                                               // an exact count, each field described
  | { min: number; max?: number; first: Field; middle: Field; last: Field };  // a count in a range (max absent: no bound)
```

With an open count, the first field has the word's literal start, the last the word's literal end, and every field between is any text (also empty where IFS may hold a character that is not blank: F20). A word's result is a union of lists of shapes: one list for each case that is not known (braces on or off, POSIX mode or not, each tuple of the known values it enumerates).

Four questions are asked of a field. Each is decided from `text`, or from `start`, `end`, `head` and `tail`:

- *May it equal t?* (`--`, `-`): t starts with `start`, ends with `end`, and is long enough.
- *May it start with c?* (`-`, `+`): `start` starts with c; or `start` is empty and its head is a `text` hole, or an `integer` hole for `-`.
- *May it be a name?* A name is an identifier, or one with a subscript (`a[i]`: F6, F46). No, when its first known character is not a letter or `_`, when its last known character is not a letter, digit, `_` or `]`, or when a character of its known start before a `[` is not a letter, digit or `_`. A field of one `digits` hole is no name.
- *May it be an assignment?* (declarations) `name=…`, `name+=…`, `name[…]=…`. No, when its first known character is not a letter or `_`, or when its known start holds a character other than those before the first `=` or `[`. Its end does not matter: `declare "$x\n"` with `x='a='` sets `a` (F40).

These four are all the spec reader asks of a field's text (section 2.4). Its exact text is asked only where it is known.

### 2.3 Computing it from the word model

The fields come from the word model (`wordMeaning`, `partMeaning` and the pieces of `braceWords` in src/semantics/words.ts), as `mayGiveNoField` (src/semantics/nofield.ts) and `wordPatterns` (src/semantics/globwords.ts) already do with holes. The word model applies bash's order (manual 3.5): brace expansion, tilde, parameter and command substitution and arithmetic, word splitting, filename expansion, quote removal.

1. **Braces.** Each word of the brace expansion is a shape of its own. Where brace expansion may be on or off in the state, both are read.
2. **Parts.** Each part takes its value from V: a known text or unset, enumerated (up to K tuples, section 6), or a hole of the kind the table above gives. An operator over a hole gives a `text` hole, except `${#x}` (`digits`), and `${x:+w}` and `${x+w}`, which give w or nothing. An operator over known values is evaluated by the word model.
3. **Pieces.** The word becomes pieces: literal text (never split: only the results of expansions are, manual 3.5.7; F43), known expanded text (quoted or not), and holes (quoted or not). Quote removal has already been done on the literal pieces (`"\<newline>-v"` is `-v`: F7).
4. **Splitting.** A field can end only inside an unquoted expanded piece. A known piece splits by the IFS where that IFS is known. Where it is not known (the script sets IFS on some path), an unquoted known piece is read as a `text` hole: its split points are not known. An unquoted `text` or `integer` hole may split anywhere. A `digits` hole splits only where IFS may hold a digit. A word whose every piece may be empty and unquoted may give no field. A quoted hole never splits; an `elements` hole gives its own count (`"-v$@"` keeps `-v` on its first field: F44).
5. **Globbing.** A field with an unquoted glob character, or with an unquoted expanded piece that may hold one, is a pattern. Its matches keep its known start before its first unquoted glob character, and its known end after its last: those characters must match as written. So a pattern field keeps `start` and `end` cut there, and gets a count from one up (none where `nullglob` may be on). This holds without the assumption that a glob matches no file (F34: `x='*'` with a file named `-vu` makes `printf $x 2` set `u`). The assumption stays only for a pattern in the script's own text with no expansion (`declare a[1]`, section 7).
6. **The result.** The shapes of each case not known, as a union.

The mode where the word expands is a fact of the state (section 2.5). POSIX mode decides whether `command declare a=$v` reads `a=$v` as an assignment (no split) or as a word (split): bash 5.2 splits it when not in POSIX mode, and does not split it in POSIX mode (F21, F22; manual 6.11: "when not in POSIX mode, assignment builtins lose their assignment statement expansion properties when preceded by command"). The word model's context rule decides it; where the mode is not known, both are read. (The comment at `fieldReadings` today says the reverse; step 4 rewrites it.)

### 2.4 The question to the spec reader

The question: for a builtin, its spec, and a line of words each known or given by shapes, which effects can bash give it?

**The effect.** What the builtin changes in the shell: each variable or function it sets, unsets, declares or gives an attribute to, with how (`variableWrites`); the options it turns on or off (`setOptionWrites`); the functions it will call (`callbacks`); and whether it runs text as code (a subscript in a name, `printf -v 'a[y=5]'`: F6; a compound assignment read again, F50, F57). It is today's `effectKey` with one change: an option flag counts only through what it makes the builtin do. A flag that changes only the output (`-p`, a `printf` format) adds nothing. A name that the effect cannot know is `?`: the scan then trusts nothing, as it does today for `read "$v"`.

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

- **V1. Written values.** A plain assignment of known text gives that text (`valuesWritten`).
- **V2. Unset.** `unset x`, `local x` and `declare x` in a function with no value make it unset: an unquoted expansion of it gives no field (F18).
- **V3. The environment.** Where no write of the script may have run on some path before the place, the value may come from the environment: a `text` hole. bash sets some variables itself (`changedUnseen`: `REPLY`, `OPTARG`, `_`, `RANDOM`…): a `text` hole.
- **V4. Writes not followed.** `read`, `mapfile`, `select`, `printf -v`, `getopts`, a `for` loop (F42), `x=(…)`, `x[0]=`, `${x:=w}`, `x+=w`, `declare -l` and `-u`, a nameref or a nameref's target (F41): a `text` hole. A copy of a parameter of a known kind keeps it (`p=$!` is `digits`).
- **V5. Positional parameters.** The walk does not follow them: `$1`, `$@` and `$0` are holes.
- **V6. A write whose target is not known** (`read "$v"`, `${!r:=x}`: F23, a nameref whose target is not known) may give any variable any value. It stays a cause of "nothing is trusted" in the allow-list (trust-allow-list.md), as today. The rule does not bound it.

The scan has no flow: it asks V for the whole script (V1 ∪ V2, or a hole where V4 or V5 applies; a hole too for a variable the script never writes, which V3 then gives everywhere). It leaves out V3 elsewhere, which needs the place; the walk adds it. The walk asks V at the place: the state's value where it is set there on every path (a known text, or unset), a hole otherwise (`kept`, not set, or values that differ by path). Since the walk's values are the scan's values or holes, the walk's effects are checked against the scan's: every effect the walk allows must be one the scan read, or the walk walks again with nothing trusted (S5 today).

Two facts say *when* code runs and *which binding* a name has then:

- **T. Time.** A trap's action, an alias's text, and a function a callback runs (and the functions they call) run at a time of their own: at any point after the command that installs them. Their values are those of any such point: the whole script's (V1, V2, V4, V5), and the environment's (V3) for a variable that may not be set when they are installed. The walk already walks them from such a widened state (`widen`, where a variable not set there is `kept`).
- **S. Scope.** A local's value holds while its function runs; a prefix assignment's value holds while its command runs (manual 3.7.4). Code that runs later may see the global or the environment's binding of the same name. So in code that T covers, a name that is local in some function, or the name of some prefix assignment, is a `text` hole, whatever the state at the installing command says (F16, F17).

S belongs in `widen`: it is a fact about the state at a later time, for every reader of that state, not about deferred words.

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

Also checked: `declare -a arr="($x)"`, `declare -a 'arr=([y=5]=1)'` and `local -a 'arr=([y=5]=1)'` set `y` to 5; `declare "arr=($x)"` without `-a` does not read the text again; `declare -A 'arr=([y=5]=1)'` takes `y=5` as a key and leaves `y`; `x='$(y=7)'; declare -a "arr=($x)"` runs the substitution, in a subshell.

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
| `declare -a "arr=($x)"` | one field, `arr=(…)` | **not gained**: bash reads the text again as code (F50); the effect "runs text" is not E₀ |

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

0. **Fix: a quoted compound assignment given to `declare -a` is read again as code.** Independent of the rule, and first. `declare -a 'arr=([y=5]=1)'` and `declare -a "arr=($x)"` set `y` (F50, F57); the model decides `[ "$y" = 1 ]` true on main. The scan reads the text in parentheses as an array assignment (arithmetic subscripts, expansions), and a text not known there trusts nothing. Also `local`, `typeset`, `declare -a arr="(…)"`; not `-A` (keys). Checked by rows in test/decisions.test.ts, run in bash. A CHANGELOG line (a fix).
1. **The field domain** (src/semantics/fieldshape.ts). `wordShapes(word, state, values)`: the shapes of section 2.2, computed as 2.3 says, and the four questions on a field. Nothing reads it yet. Its test (test/fieldshape.test.ts) is differential and generated: words with literal starts and ends, quoted and unquoted holes of each kind, braces, `\<newline>`, `$"…"`; states with the default IFS, a blank and a non-blank IFS, `nullglob`, `set +B`, POSIX mode; and random values for the holes. Each runs in bash (in a cgroup, `FUNCNEST` set, killed as a process group) and prints its fields. The test checks that bash's fields lie in the union of shapes, and that the four questions answered "no" hold for each of them. This is the foundation: it is reviewed before step 2 builds on it.
2. **The question to the spec reader** (src/argv/fieldreadings.ts). `builtinEffects(name, spec, line, values)`: the effect of 2.4, the refusal rules (a field of `OperandSpec` for a name bash refuses, with a row per builtin), the counts with S and the ties of readings.ts, the classes, the early stop and the cap C. Nothing in the trust reads it yet. Its test is differential too: for each builtin the scan defers (`set`, the declarations, `printf`, `read`, `getopts`, `mapfile`, `wait`, `complete`…), random lines of known text are run in bash, and the variables, attributes and options before and after are compared (`declare -p`, `set -o`); bash's change must be one of the effects the reader gives for any shape that holds the line. The facts of section 3.3 become rows.
3. **Shape first.** The scan and the walk ask step 2 with every part a hole before anything else; a word whose shape allows only E₀ gets no plan. `inert`, `inertAfter`, `literalStart` and `expands` go (S9, S10, S11). Checked: every row of the past counterexamples in test/decisions.test.ts stays undecided; the idioms of section 1.3 get rows that are decided, each run in bash; the generator (case 38) gets words with a literal start or end around a value not known (`printf "$y\n"`, `printf "-v$y" u 2`, `printf "$y%s\n" a`, `getopts -- $o`). Measured on the three sets; the snapshot changes only where an input gains its trust.
4. **Values as holes.** `valuesWritten` gives known texts or a hole with a kind; `fieldReadings` enumerates the known parts and makes holes of the rest; past K tuples, parts become holes instead of the words being read as written; an IFS not known makes unquoted known parts holes. The plan holds the scan's effects, and the walk's check is "its effects are in the scan's" (S2, S4, S5, S6, S8; S1 and S3 stay as V1 and V2). Checked by test/decisions.test.ts and the generator; the comment at `fieldReadings` on POSIX mode is corrected (S7). Measured on the three sets.
5. **Time and scope in `widen`.** In code that runs at a time of its own, a name that is local in some function, or the name of some prefix assignment, is a hole (S); the walk then checks such code like any other, and the scan's `late` check goes (S12, S13, S14). Checked by the trap, alias and callback rows of test/decisions.test.ts, and new generator cases: a trap set in a function with a local, and in a function called with a prefix assignment, each run in bash.
6. **Documents.** trust-allow-list.md, section 6, points here for deferred words; the roadmap item moves to "Done lately"; README Limitations states A1 as it now stands.

## 6. Costs and caps

- **K, the tuples of known values** enumerated for one builtin: 16, as `READINGS` today. Past K, parts become holes. This loses precision, never soundness.
- **C, the lines read** for one builtin: 1,024, as `SHAPE_CAP` in readings.ts. A line is one `builtinRead`, about 0.03 ms (count-hedges.md, 2.8). Past C, the answer is "may change".
- **The common case is small.** A `printf` with one quoted field reads five classes (not an option, `-`, `--`, `-v` with the rest, a letter it does not have). A `declare $x` stops at its first class that sets an attribute. Shape first needs no values, so most builtins are read once per text: the cache of `deferredReadings` (by text, shell, POSIX mode and IFS) stays, keyed by the shapes.
- **Counts.** A word with an open count is read at its fewest up to S + 1; with ties, fewer. For the builtins read so, S is 4 to 6 (`declare`, `read`, `mapfile`: 4; `printf`, `set`: 5; `getopts`: 6).
- #501 measured 1,500 lines of `printf "%s …" "$a" … "$f"` at about 0.55 s for the model. Step 3 measures the same file, and one of 1,500 `printf "$x\n"` lines, which reads every line today.

## 7. Known limits

- A pattern of the script's own text matches no file (A1): `declare a[1]` is read as declaring `a[1]`.
- A name not known stays a cause of "nothing is trusted": `read "$v"`, `printf -v "$v"`, `complete -F $f`, `unset {a,$v}b`.
- `$"…"` is a hole: a translation may start with `-`. `printf $"Copyright %s $y" 2024` stays not trusted.
- A `for` loop's values are a hole even over known words (F42); listing them is left.
- `unset`, `shopt` and `enable` are still read as written (S17); the rule could read them later.
- Where the walk's values differ from path to path, it reads a hole rather than each path's value.
- `cannotFail` (src/semantics/status.ts) says that `printf` of words with no `$( )` cannot fail; `printf $((-5))` fails (F31). It feeds a note on pipelines, not a decision (A3), and is left.
- The effects of a builtin in bash 5.3 that differ from 5.2 are read from the spec of that version; step 2's test runs bash 5.3 (`$BASH_EXPLAINER_BASH53`) where it is set.

## 8. For the maintainer

- The gain counted in whole inputs is small: one snippet of 1,861, none of the generated or real scripts (section 4.2). The idioms are gained where nothing else hides them.
- The case for the rule is soundness that can be reviewed in one place. Each of #501's review rounds found a hole in a special case; under the rule, each past case follows from F, E, the values V1 to V6, or the facts T and S (section 3.1).
- Step 0 is a wrong decision on main today, independent of the rule. It could go first whatever is decided for the rest.
- Steps 1 and 2 are the foundation, and are tested against bash on their own. Step 3 gains the idioms and removes S9 to S11. Steps 4 and 5 remove the rest of the special cases, and gain little by themselves.
