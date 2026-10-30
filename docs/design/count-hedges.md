# Hedges by word counts, read for every count at once

Status: planned (2026-10-30), revised after review. The maintainer agreed to "a design document first, then steps that keep every test passing". Step 1 done (#499); the others not started. The roadmap item is under "Now" in [../roadmap.md](../roadmap.md).

An unquoted `$a` may give no word, one word or several. The role of a word on the line can then depend on how many words `$a` gives: with `$a` empty, `tar -cf $a b` is `tar -cf b`, and `b` is the archive. The explanation says such roles under a condition ("value for `-f` when `$a` expands to nothing"); this page calls them hedges. Since #492, a hedge must hold for every count that meets its condition (oracles.md 2.8). The hedges read one word's count at a time, and read the options once. Several lines break that rule. This page shows the cases, proposes one design that reads every count of every such word together, and gives the steps.

## 1. The problem

### 1.1 How the hedges are read today

The argument interpreter (`interpret` in src/argv/interpret.ts) reads the words of a command with its spec. A word that may give other than one field has a `count` (`ArgWord.count`, from `countOf` in src/argv/words.ts): an unquoted `$a` is `{ min: 0 }`. The interpreter reads the line once with each word as one word (its fewest, one at least). That reading is `ArgvParse.roles`, which the explanation, the examples, the pitfalls and the idioms all read. The hedges are added to it as lazy getters (`withHedge`, and the `lazy` getters of src/argv/valuehedges.ts). The explanation reads them. So does `plain` in src/argv/regroup.ts, which reads `uncertain` and `none` when it folds the fields of a word the model knows: that forces the hedges on any call of `interpret` with such a word, whoever asks.

Two modules read the hedges, each in its own way:

- **The operands** (src/argv/hedge.ts, `hedges`). The options are already read. The operand patterns are matched again with other counts of the operand words: `several` (the word's own count), `byCount` (the count of one other word), `otherwise`, `mixed` (any counts of two or more words, said without conditions) and `none` (`Hedges.none`: the words that may give none giving none, every count of the others). The options are not read again.
- **The values** (src/argv/valuehedges.ts, `valueHedges`). An option's value that may give none or several is read again: the whole line without it (`without`, a "bare" reading), or with 2 to `mostWords(spec)` words of it (`spread`). This gives `none` and `more` on the words after it, and `rest` on the value. In each of those readings, every other word of the line gives one word. Its `hedge` adds to an operand's `none` too, and keeps only a role that is an operand's or a value's: a word that becomes an option is not said.

So each hedge varies one word, or (in `Hedges.none` and `mixed`) the operands of one reading of the options. A condition on one word can then be contradicted by another word's count. A word whose role changes only because the options read differently (`tr $a -d`) gets no reading at all.

### 1.2 The cases

Each case below was run in bash 5.2.21 with the real tool (GNU coreutils 9.4, GNU grep, jq 1.7, glibc 2.39 getconf), in a cgroup, for each count of each variable. "We say" is the English explanation of main (5dd67b1d), from `npx tsx test/dump.ts`. The interpreter reads each written-out argv right in every case below (`interpret` on the words bash gives, rendered with test/support/argwords.ts). Only the hedges are wrong.

**`jq --arg $n $v .`** (two unknown words in a row, after an option with two values)

| `$n`, `$v` | bash gives | jq does |
| --- | --- | --- |
| none, none | `jq --arg .` | refuses: `--arg takes two parameters` |
| none, `VV` | `jq --arg VV .` | `.` is the value; no filter, so jq uses `.` |
| none, `VV .` | `jq --arg VV . .` | the second word of `$v` is the value; the last `.` is the filter |
| `x`, none | `jq --arg x .` | `.` is the value |
| `x`, `VV` | `jq --arg x VV .` | `.` is the filter (the reading as written) |
| `x $x`, `VV` | `jq --arg x '$x' VV .` | `VV` is the filter (`VV/0 is not defined`) and `.` a file |

We say of `.`: "jq filter (e.g. `.items[].name`); input JSON file or jq filter (e.g. `.items[].name`) when `$n` expands to several words; input JSON file when `$v` expands to several words; value for `--arg` when `$n` or `$v` expands to nothing". With `$n` empty and two words of `$v`, `.` is the filter: two of those conditions hold there, and both name another role. We say of `$v`: "…; when `$v` expands to several words, this is its first word, and each of the others is jq filter (e.g. `.items[].name`) or input JSON file; …". With `$n` empty, the second word of `$v` is the value.

The role of `.` depends only on how many words `$n` and `$v` give in all: none, jq refuses; one, the value; two, the filter; three or more, a file.

**`jq --arg $n v $f`** (the same, with a known word between)

With `$n` empty and `$f` = `. -`, bash gives `jq --arg v . -`, and jq reads `-` as the filter (`syntax error, unexpected end of file`). We say of `$f`: "jq filter (e.g. `.items[].name`) when `$f` expands to a single word; when it expands to more, they are jq filter (e.g. `.items[].name`), then input JSON file; …; its first word is value for `--arg` when `$n` expands to nothing". The second word of `$f` is then the filter, not a file.

**`cut -d $a -f $b f`** (two values, a known option between)

| `$a`, `$b` | bash gives | cut does |
| --- | --- | --- |
| none, none | `cut -d -f f` | `-f` is the delimiter (refused: `the delimiter must be a single character`); `f` is a file |
| `:`, none | `cut -d : -f f` | `f` is the field list (`invalid field value 'f'`) |
| `: g`, none | `cut -d : g -f f` | `g` is a file; `f` the field list |
| `:`, `2 g` | `cut -d : -f 2 g f` | prints field 2 of `g`, then of `f` |

We say of `f`: "target file; value for `-f` when `$b` expands to nothing". With both empty, `-f` is the value of `-d`, and `f` is a file. The value of `-f` needs `$b` empty and `$a` one word or more.

**`cp -t $d $a b`** (a value and an operand in a row, both may give none)

| `$d`, `$a` | bash gives | cp does |
| --- | --- | --- |
| none, none | `cp -t b` | `b` is the directory: `missing file operand` |
| none, `s1` | `cp -t s1 b` | `s1` is the directory: `target directory 's1': Not a directory` |
| `D`, none | `cp -t D b` | copies `b` into `D` |
| `D E`, `s1` | `cp -t D E s1 b` | copies `s1` and `b` into `D`; `E` is a source (`-r not specified; omitting directory 'E'`) |

We say of `b`: "source", with no hedge. Both words must give none for `b` to be the directory: neither module reads that.

**`grep -e $p -- -v f`** (a word that becomes an option)

With `$p` empty, bash gives `grep -e -- -v f`: `-e` takes `--` as the pattern, and `-v` is the option "invert". grep prints the lines of `f` that do not hold `--`. With `$p` = `a`, `-v` is a file (`grep: -v: No such file or directory`). We say of `-v`: "file to search (default: stdin)", with no hedge. (We say of `--`: "…; value for `-e` when `$p` expands to nothing", which is right.) valueHedges reads `-v` as the option there, but its `hedge` keeps only an operand's or a value's role.

**`tr $a -d`** (`optionsFirst`: options end at the first operand)

| `$a` | bash gives | tr does |
| --- | --- | --- |
| none | `tr -d` | `-d` is the option: `missing operand` |
| `a` | `tr a -d` | `-d` is the second set: `abc-dx` becomes `-bc-dx` |
| `a b` | `tr a b -d` | `extra operand '-d'` |

We say of `-d`: "target character set (e.g. `A-Z`) when `$a` expands to a single word; extra operand, … when it expands to more — …; lone character set, which the command refuses (…) when `$a` expands to nothing". With `$a` empty, `-d` is the option "delete the characters", not an operand.

**`getconf $a -a`** (`optionsFirst`, the same)

| `$a` | bash gives | getconf does |
| --- | --- | --- |
| none | `getconf -a` | `-a` is the option: prints every variable |
| `NAME_MAX` | `getconf NAME_MAX -a` | `-a` is the path: `pathconf: -a: No such file or directory` (status 3); with a directory named `-a`, prints `255` |
| `PAGESIZE /` | `getconf PAGESIZE / -a` | the usage (status 2) |

We say of `-a`: "path (…) when `$a` expands to a single word; extra operand, … when it expands to more; variable (…) when `$a` expands to nothing". With `$a` empty, `-a` is the option.

**`echo $a -n x`** and **`/usr/bin/echo $a --version`** (the same, in the builtin and in coreutils)

With `$a` empty, `echo -n x` prints `x` with no newline: bash's `echo` reads options first, and `-n` is one. With `$a` = `y`, it prints `y -n x`. We say of `-n`: "text to print", with no hedge. With `$a` empty, `/usr/bin/echo --version` prints `echo (GNU coreutils) 9.4`: coreutils' echo reads `--version` when it is the one argument. With `$a` = `y`, it prints `y --version`. We say of `--version`: "text to print".

**`nice $a -n 5 ls`** (a word that may give none in a command slot)

With `$a` empty, bash gives `nice -n 5 ls`: nice runs `ls` at niceness 5. With `$a` = `echo`, nice runs `echo -n 5 ls`, which prints `5 ls` (checked with `echo y` for `ls`). We say `$a` is the command ("runs `$a`"), and `-n` an option of `$a` that the dictionary does not have, with no hedge. The words after `$a` are read by the command it runs; with `$a` empty, they are nice's own.

### 1.3 What the cases have in common

The interpreter reads each argv right. The hedges go wrong because they read the line with one count changed at a time, and with the options fixed:

- Two words that may give none or several, in a row or apart, decide a later word's role together (`jq`, `cut`, `cp -t`).
- Where options end depends on the counts (`optionsFirst`: `tr`, `getconf`, `echo`; one argument alone: `/usr/bin/echo`; a command slot: `nice`), but the options are read once.
- A word that becomes an option is not said (`grep -e $p -- -v f`).
- A value and an operand are hedged by two modules, which do not see each other's words (`cp -t $d $a b`).

Each fix so far (#482, #484, #487, #490, #492) added a reading for one more kind of word. The roadmap's open item lists more of the same: the words a command run reads after it (`sudo -u $u tar -cf x y`), and two words of one variable read as independent (`cp $a $a d` says "when `$a`, `$a` expand to a single word"). The fixes keep adding special cases, so this page proposes one reading for all of them.

## 2. The design

### 2.1 Runs, coordinates and shapes

The **flexible** words of a command are those whose count is not exactly one: `count.min` 0, or `count.max` other than 1. A word with an exact count is not flexible, and is read as it is today: a brace word `{-l,-a}` (count 2) is its two known fields, the options `-l` and `-a`.

A **run** is a sequence of words in a row, none with a known text or start (`value`, `prefix`), with at least one flexible word: `$n $v` in `jq --arg $n $v .`, `*.c *.h $a $b` in `cp *.c *.h $a $b dir`. A known word ends a run (`-f` in `cut -d $a -f $b f`). A flexible word with a known start (`x$a`, `-n$a`) is a run of its own, since its first field keeps that start.

The written-out line depends only on how many words each run gives in all: the words of a run have no known text, so `x y` and `z` give the same argv as `x` and `y z`. So a **shape** is one value of the sum of each run. As a **coordinate** that other words read (section 2.4), a sum has a capped domain: from the sum of the fewest counts of its words (0 for a word that may give none) up to that plus S, or to the sum of the largest counts where that is smaller. The top value stands for "that many or more" where the words may give more. A sum that holds a word at its top is at the top too (hedge.ts caps its sums the same way, `Math.min(n + c, span)`).

A word inside a run needs more than the capped sum of its run. Its fields' places depend on the words before it, its own count and the words after it, each up to S. So each part is capped at S, and the run is read at the real sum of the parts: up to its fewest plus S for a run of one flexible word, 2S for two, 3S for three or more. Reading the capped sum instead would be wrong. In `cp $a $b`, `$a` with five words and `$b` with four make nine, past S = 7: a run cut at 7 leaves `$b` two places. A profile by place (section 2.4) read from such a cut reading can be false where a pattern has fixed items after a repeat. Read at real sums, every context of a word has the same own counts, 1 up to the top, so its profiles compare.

The shapes read are the union, over the runs, of that run at its real sums and the other runs at their capped domains. They are enumerated directly, never as the product of the words' counts. `cp $a $b $c $d` is one run of 22 shapes (sums 0 to 21), where the counts of the four words, each up to S + 1, make 6,561 vectors.

S is the number of words past which every count reads the same: `mostWords` (src/argv/valuehedges.ts), two plus the most values one option takes plus the longest operand pattern, for a spec without options two plus its longest pattern. It is 7 for cp, mv, ln, install and scp; 6 for jq, rsync, tr and getconf; 5 for ssh, grep, sed and sudo; 4 for cut, echo and nice. A reading may visit a spec the reading as written does not: `nice $a …` runs `-n`'s command or nice's own, `git $a log -n $b x` reaches `log` only with `$a` empty. So S is the largest over every spec any shape may visit, taken statically: the command's spec, each subcommand a known word of the line names under a spec already taken, and each spec a known word names as a command (`lookup`). That set holds every spec a reading can reach, since a reading only enters a spec through a known word (a word of unknown text names no spec).

The **base shape** gives each word its fewest, one at least: the line as written. Its reading is `ArgvParse.roles`, unchanged. Every reader that does not ask for hedges (the examples, the pitfalls, the idioms, the semantic facts) keeps reading it.

### 2.2 Tied counts

Two words that are the same lone unquoted expansion of one variable (`$a` and `${a}`, with no quotes and nothing else in the word) give the same number of words, if nothing on the line assigns the variable or IFS between them. They share one count: `cp $a $a d` has one count variable, and no shape where the two differ. The expansions that assign on the line, and so cut a tie, are `${a:=x}`, `${a=x}`, the arithmetic ones (`$((a=1))`, `$((a++))`, `$((a+=1))`, in an index too: `${b[a=1]}`), and the same forms of `IFS`. A tie inside a run makes its sum a multiple (`$a $a` gives 0, 2, 4…): the shapes are then gathered by a pass over the count variables that keeps the distinct tuples of sums, as `sums` in hedge.ts does. A tie also puts a word's own count into its coordinates: in `cp $a $a d`, the sum after the first `$a` is the count of the second, which is its own. So a word's context is defined over the count variables (section 2.4), not over the coordinates. `$a/x`, `"$a"` and `$1` with `$@` are not tied (section 5).

### 2.3 One reading per shape

For a shape, the line is written out from `interpret`'s own `line`, in which the words whose fields the model knows are already those fields (`groups`). A run with sum s becomes s words with no known text (`{}`); a run of one word with a known start keeps that start on its first word (`spread` does this today). The whole line is read again with the spec: options, values, `--`, operands, subcommands, command runs. A reading for the roles only does not compute hedges of its own (the `bare` flag of today). The roles go back to the words of the command through `lineIndex` and `regroup`, as the base reading's do.

A shape can end in three ways:

- **Read**: every word has a role.
- **Refused, as the interpreter knows it**: an option whose value no word gives (`missing`: `jq --arg .`), or operands that no form fits (`parse.unmatched`). A refused shape gives no word a role to state (section 2.5).
- **Not known**: the pattern matcher gave up (`parse.gaveUp`, past `maxSteps`). The words whose role may differ there say only that it depends on the counts (the text past the cap, section 2.8).

The tools refuse more than the interpreter knows. `cp -t b` (`missing file operand`) and `tr -d` (`missing operand`) set neither `missing` nor `unmatched`. Those shapes are read, and their roles are said: section 2.6 gives `b` the value of `-t` and `-d` the option. The roles are right, but the explanation does not say that the tool then refuses. That is a known limit. A field of the spec for the operands a form or an option needs at least would mark them refused; it is left for later (section 5).

### 2.4 Profiles: a word's roles for each of its own counts

The explanation is per word, so the shapes are read again from the point of view of each word k. Its own count c is the value of its count variable (section 2.2). Its **context** is the values of the other count variables, seen through the coordinates: the sums of the other runs and, where k is in a run, the sums of the words before it and after it in its run. Each of these leaves out what k's own variable gives it, and is capped at S. A coordinate that only k's own variable fills (the second `$a` of `cp $a $a d`, for the first) is no part of the context. The contexts are gathered by a pass over the other variables that keeps the distinct tuples of capped sums, as `sums` in hedge.ts does, never by their product. A context and an own count give the real sums, so the shape read (section 2.1), and k's fields their places in it: each field gets a role.

- c = 0: k gives no word. That is no class and no clause of k's own. (Other notes say "expands to no word"; the context coordinates of the other words carry it.)
- For each context, k's **profile** is its roles for every own count from 1 up to the top: a list for each count.

A profile is said in one of two ways:

- **By place**, where the role of k's i-th field is the same for every own count of i words or more: "this is its first word, and the others are jq filter, then input JSON files" (the last role for every word after). This is the `rest` and `more` of today, and holds only where no place's role depends on the own count.
- **By own count**, where some place does: "when it expands to 2 words, they are source, then destination (…); when it expands to more, they are source, then destination directory" (`cp $a`, #484: the second word is the destination with two words, a source with three). This is today's `several`.

An own count whose shape is refused is left out of the profile's text, and kept in its comparison (two profiles are equal only with the same counts refused). A word that is not flexible has a profile of one role.

### 2.5 Classes and conditions

For each word, the contexts fall into **classes**: the contexts with the same profile. The class of the base context is the word's profile as written, said first, as today. Each other class is said in clauses "profile when C", where C holds for every context in it.

A condition is a conjunction of at most two **atoms**. An atom is a set of values of one context coordinate, said with the phrases the texts have:

- of one word (a run of one word, or the words before or after k in its run when that is one word): "expands to nothing" (0), "to a single word" (1), "to several words" (2 or more), "to n words" (n), "to n words or more" (n or more, also for 1: "to a word or more");
- of several words (a run, or the part of k's run before or after it): "expand to nothing" (all 0), "expand to n words in all", "to n words or more in all". A role after a run depends on the sum only, as `mixedOf` reads today.

A clause is **sound**: every context that meets its condition has its profile. The clauses of a word together are **complete**: they cover every context whose profile differs from the base one, except the contexts where every own count is refused. For each class, each atom and each pair of atoms is checked against the class, the largest that lie in it are kept, and a greedy cover picks the fewest. Each atom is a bitset over the contexts, so a check is an AND of two bitsets and a comparison.

**The budget is counted after the grouping by profile**: at most four clauses per word. Past four, or for a class that no conditions of two atoms cover, the word's other classes are folded into one text without conditions: "X or Y, by how many words `$a`, `$b` and `$c` give", the roles of their profiles once each (today's `mixed` text). It names the roles but no condition, so it is sound and complete.

A context where every own count is refused gets no clause: the explanation does not say what the word is when the interpreter knows that the tool refuses the words (section 2.3; refusals it does not know are read like any shape). This keeps the rule of #492 (a reading that gives a role no hedge names makes the hedge claim nothing: `union` in valuehedges.ts), now per context. Saying the refusal itself ("jq refuses the words when `$n` and `$v` expand to nothing") on the command's token is a later choice (section 6).

### 2.6 What the explanation says

Each word keeps its profile as written first, then a clause per class. The texts below are those the algorithm of 2.4 and 2.5 gives for the cases of section 1.2 (wording to be settled in the steps):

- `jq --arg $n $v .`, of `.`. Its context is the sum of the run `$n $v`: 0 is refused (`--arg` is `missing`), 1 the value, 2 the filter (the base), 3 or more a file. Two clauses: "jq filter; value for `--arg` when `$n` and `$v` expand to one word in all; input JSON file when they expand to 3 words or more in all".
- The same line, of `$v`. Its context is the words before it in its run, `$n` alone. Each class is a profile by place. `$n` with one word (the base): value, then jq filter, then input files. `$n` empty: name, value, filter, then files. `$n` with two words: filter, then files. `$n` with three or more: files. Three clauses: "value for `--arg`; when it expands to several words, the others are jq filter, then input JSON files; when `$n` expands to nothing, its words are name for `--arg`, value for `--arg`, jq filter, then input JSON files; when `$n` expands to 2 words, jq filter, then input JSON files; when `$n` expands to 3 words or more, input JSON files".
- `jq --arg $n v $f`, of `$f`. Its context is `$n`. `$n` empty: value, then filter, then files. One word (base): filter, then files. Several: files.
- `cut -d $a -f $b f`, of `f`. Its context is the two runs `$a` and `$b`. Only `$b` empty with `$a` one word or more gives another profile. One clause: "target file; value for `-f` when `$b` expands to nothing and `$a` to a word or more".
- `cp -t $d $a b`, of `b`. Its context is the run `$d $a`. One clause: "source; value for `-t` when `$d` and `$a` expand to nothing".
- `grep -e $p -- -v f`, of `-v`: "file to search; option `-v` (invert the match) when `$p` expands to nothing".
- `tr $a -d`, of `-d`: "target character set; option `-d` (delete the characters) when `$a` expands to nothing; extra operand … when it expands to 2 words or more".
- `getconf $a -a`, of `-a`: "path; option `-a` (print all variables …) when `$a` expands to nothing; extra operand … when it expands to 2 words or more".
- `echo $a -n x`, of `-n`: "text to print; option `-n` (no newline) when `$a` expands to nothing". `/usr/bin/echo $a --version`, of `--version`, the same way.
- `nice $a -n 5 ls`, of `-n`: "argument of the command `$a` runs; option `-n` of `nice` when `$a` expands to nothing" (and `5`, `ls` the same way).
- `cp $a`, of `$a`: no context, one class, a profile by own count: the text of today.

One field of the role replaces today's fields. `OperandRole` loses `uncertain`, `otherwise`, `by`, `several`, `byCount`, `mixed` and `none`; `ValueRole` loses `rest`; the other roles lose `none` and `more`. Each role gets one lazy field, `readings`: its base profile, its clauses (each a profile and its atoms), and the words of a folded text. src/explain/operand-texts.ts renders them; the phrases of today ("when it expands to 2 words", "its first word is …") stay where they fit.

The texts change only where today's are unsound or say less: a clause on one word that held for every count of the others reads the same. The corpus is checked before and after each step (`test/snapshot.ts`), and every changed text is checked against the table.

### 2.7 The texts in Japanese

The new phrases are role texts, rendered with `cx.s` in src/explain/operand-texts.ts as today's are, not notes of the catalog. They follow docs/japanese-style.md, after the phrases there now ("`$a` が2語以上に展開されるなら", "が0語なら"):

- a sum: "`$n` と `$v` が合わせて1語なら", "合わせて3語以上なら";
- two atoms: "`$b` が0語で `$a` が1語以上なら";
- the folded text: "`$a`・`$b`・`$c` が展開される語数により、X または Y";
- the text past the cap: "`$a`・`$b` が展開される語数により役割が変わりうる".

The renderings check (test/support/renderings.ts) reads the English texts only, so steps 4 to 6 add tests of the Japanese texts of the cases.

### 2.8 Bounds and cost

Measured on the snippets of the tests (test/fixtures/snippets.json, 1,860 snippets), with `argWord` (no model, so every unquoted expansion may give none; the explanation's `argWordIn` knows more, so these are upper bounds), with S over the specs the known words name:

| What | Count |
| --- | --- |
| Commands with a spec | 1,700 |
| With a flexible word (section 2.1: a count not exact) | 223 |
| Runs with a flexible word, per command | one: 218, two: 5, more: none |
| Shapes per command | median 5, 90th percentile 6, 99th 16, most 36 |
| Time to read every shape of the 223 commands | 69 ms in all (1,300 readings), 0.05 ms per reading |
| One `interpret` call (no hedges asked) | 0.03 ms |

The shapes stay few because the words of a run give one sum. Lines whose word counts blow up give few shapes: `cp $a $b $c $d` (6,561 vectors) is 22 shapes; `ssh $o $h $c $x` (2,401) is 16; `echo ${@} $? ${#} $_` (1,296, in the corpus) is 13; `cp *.c *.h $a $b dir` (5,184, explained right today) is 22. Most runs of the corpus hold one flexible word, so reading at real sums adds few shapes there.

The conditions cost little next to the readings. A word has at most a few context coordinates, each with at most S + 1 values (8), so at most about 50 atoms and 1,300 pairs. A word in a run, with one other run, has at most 8^3 = 512 contexts. Each check is an AND of two bitsets of at most 4,096 contexts (64 machine words) at the cap. Only words with a class other than the base one are covered.

- **No shortcut by spec.** An earlier draft skipped a spec "whose roles cannot change" (one operand role, no value, no command slot). That is wrong: `echo` reads options first, and `echo $a -n x` changes. At five shapes a command, the table costs too little to need a shortcut.
- **The shapes are capped at 1,024** (about 60 ms of readings), computed from the run domains before any is read, and the contexts of a word at 4,096. A run read at real sums has at most 3S + 1 sums (22 for cp), a capped coordinate at most S + 1 (8). One or two runs stay under 400 shapes (22·8 + 8·22). A line passes the cap only with three runs apart, one of them of three flexible words or more (22·8·8 = 1,408), or with four runs (6^4 = 1,296 at S = 5): none in the corpus.
- **Past the cap**, each word keeps its role as written, and a word whose role may depend on the counts says only that: "its role may depend on how many words `$a`, `$b`, … give". That is sound; the renderings check is taught to count it as a missing explanation, not a contradiction. Which words say it is decided without reading. They are every word at or after the first flexible word, and every word before it whose role as written is an operand. The readers of options read left to right (getopt's scan, `optionsFirst`, the values after an option, `--`), so an option, a value, a subcommand or a command name before the first flexible word keeps its role. Operands are placed by patterns over all of them (`seq 5 $a`: `5` is the last number when `$a` expands to nothing, the first otherwise), and a rule on the one argument (`/usr/bin/echo --version $a`) reads them all too. Step 2 checks the bound over the corpus: every word whose classes differ in the full table is in that set.
- The table is built once per call of `interpret`, when first asked, and kept for the call.

### 2.9 Who asks for the table

The explanation asks, through `readings`. So does `plain` in src/argv/regroup.ts, which folds the fields of a word the model knows into one role when every field is a plain operand with no hedge. It reads `uncertain` and `none` today, and so forces the hedges in every call of `interpret` on such a line: the pitfalls, the idioms and the semantic facts too. In the table, `plain` asks `readings`, which is not read where no word of the line but the folded one is flexible (it is then undefined, the role certain). Where another word is flexible, the table is read: a few readings (section 2.8), once per call. Step 4 measures it on the corpus with every reader of `interpret`.

### 2.10 The examples

The examples (src/examples/, src/explain/examples.ts) read the base reading. They stay on it: an example shows the line as written, with each word one word. The table can tell when that matters: when a word the example reads (as data, as a program such as a jq filter, or as the file it reads) has another class than the base one. The example then says so in its heading ("with `$n` and `$v` one word each"). In `jq --arg $n $v .`, the output shown is that of the filter `.`; with `$n` empty and one word of `$v`, `.` is the value and jq runs its default filter, by chance the same. The example need not know that; it says what it assumes.

### 2.11 What folds into it

| Today | In the table |
| --- | --- |
| hedge.ts `several` | a profile by own count |
| hedge.ts `byCount`, `otherwise` | clauses on one other word's count |
| hedge.ts `mixed` | clauses on two coordinates, or the folded text |
| `Hedges.none` (`noneOf`) | a clause "when … expand to nothing" on the words that drop |
| valuehedges.ts `none` | a clause "when `$a` expands to nothing", on any word after it, with the options read again |
| valuehedges.ts `more`, `rest` | profiles by place, and clauses on the value's count |
| `mostWords`, `span` | S (section 2.1) |
| the `kinds` runs, `sums` and the cache of hedge.ts | runs, sums and shapes (sections 2.1 and 2.2) |

hedge.ts and most of valuehedges.ts go. `mostWords`, `roleText`, `sameRole`, `thenRoles` and `allRoles` move to the table's module; `ThenRole` and `sameRole` also name options and commands. `placeOperands` keeps only the base reading.

## 3. Alternatives

**A. Every shape, profiles, classes, conditions of at most two atoms (this page).** One reading of the whole line per shape. It covers the options, the values, the operands, the command runs and the subcommands with one rule, and its clauses are sound by construction. The shapes of a line are few, since a run gives one sum, and the table is lazy. Its texts can be longer where two words interact; the budget and the folded text bound them.

**B. Keep one count at a time, and say the assumption.** Each clause gets "(the other words one each)": "value for `-f` when `$b` expands to nothing (and `$a` to one word)". It costs nothing more. But a reader cannot tell what happens with both empty, so the explanation is silent on a count it could read. The renderings check (every role of every count shown) still fails there. It does not fix the options read once (`tr $a -d`, `echo $a -n x`, `nice $a -n 5 ls`) nor a word that becomes an option (`grep -e $p -- -v f`): those need the line read again, which is A's reading. B is a wording, not a fix.

**C. Read counts symbolically.** Turn each spec into a grammar over argv shapes and solve for the counts (intervals, or Presburger formulas) instead of enumerating. Exact, with no cap. But the option parsers are procedures (getopt's permutation, `optionsFirst`, cobra's search, values taken from the next word, `--`), and every one would need a symbolic twin. That is a second interpreter, which semantics.md part A set out to avoid.

**D. Show whole-line readings as alternatives.** Group the shapes by the roles of every word at once, and show each class as a reading of the line ("Reading 1 of 3: when `$n` is empty…"). This tells the reader most, but the explanation is a token per word, and the panel has no place for alternative readings. It can be built on A's table later, if the panel redesign ([panel-redesign.md](panel-redesign.md)) wants it.

Recommended: A. It is the only one that fixes the cases of section 1.2, and the table it builds is what D would need.

## 4. Steps

Each step keeps every test passing, and lands as its own PR. The tests that compare with the real tools are in test/count-hedges-real.test.ts: each variable gives each count from none to four, the tool runs, and the explanation must allow the role of every word it gives (`showsRole`).

1. **The cases, as known contradictions. Done (#499).** Add the lines of section 1.2 to `CASES` in test/count-hedges-real.test.ts: `nice` with `seen` from what it ran, `getconf` with a directory named `-a`, `echo` (the builtin, through bash) and `/usr/bin/echo` with what they print, `grep -e $p -- -v f` with a file holding `--`. The counts whose roles today's texts contradict go in test/fixtures/count-hedges-known.json (line, counts, word, reason); the test fails on a contradiction not listed and on a stale entry, as test/fixtures/bash-ast-known.json does. No change in src/. Done: the cases are in CASES (the line of each case is the line of section 1.2); test/fixtures/count-hedges-known.json holds 19 entries (an entry names the line, the word, the counts it holds for and the step that fixes it; the test fails on a count it covers where the explanation is right); the checker (test/support/renderings.ts) now reads "… when it expands to more — comment" (`tr`) and says a later field of a two-word value (`$v` of `jq --arg $n $v .`) is not shown by a token that gives the others as operands. The words of a command run (`nice $a -n 5 ls` with a command in `$a`) are shown under it with a token that names no role: that is a missing explanation, not listed; with `$a` empty, the words nice reads itself are shown under `$a`, which is listed (count 0 only; also `timeout 5 nice $a -n 5 ls` and `nice nice $a -n 5 ls`, where the inner nice reads them). Where the tool refuses the words (`timeout -s $s 5 echo x` with `$s` empty), which command reads a word is not compared.
2. **The table.** A module src/argv/readings.ts: runs, ties, coordinates and their domains, S over the specs the known words name, the shapes and the cap, the written-out line from `interpret`'s `line`, a reading per shape (read, refused, not known), and the roles mapped back through `lineIndex` and `regroup`. Nothing reads it yet. Tests (test/readings.test.ts): the runs, the domains, the ties (`cp $a $a d` has no shape where the two differ; `${a:=x} $a` has two counts) and the cap; for every shape of the cases, the table's roles equal those `interpret` gives the argv written out with the texts bash gives; a word inside a run is read at its real sum (`cp $a $b` with five and four words); over the corpus, every spec a reading visits is in the set S is taken over, and the roles at S equal those at S+1 and S+2 (the bound holds); the words that the text past the cap names hold every word whose classes differ; the time to build the table for the corpus.
3. **Profiles, classes and conditions.** In the same module, as data: the contexts of each word, its profiles by place or by own count, the classes, the atoms, the cover, the budget and the folded text. Tests: for every command of the corpus and every word, the clauses are sound and complete over the table (a property test); the profiles and clauses of the cases of section 2.6, written out.
4. **The operands read the table.** A word whose role as written is an operand takes its readings from the table, and hedge.ts goes. In the same step, `valueHedges` stops hedging operands: its `hedge` no longer adds to an operand's `none`, and its `more` is not set on an operand (`HEDGED` loses `operand`), so an operand never gets clauses from both. `plain` in regroup.ts reads `readings` (section 2.9). src/explain/operand-texts.ts renders the clauses; test/support/renderings.ts reads the new phrases (two atoms, the sums of a run), and tests of the Japanese texts are added. This fixes `b` of `cp -t $d $a b`, `f` of `cut -d $a -f $b f`, `.` of `jq --arg $n $v .`, `$f` of `jq --arg $n v $f`, `-v` of `grep -e $p -- -v f`, `-d` of `tr $a -d`, `-a` of `getconf $a -a`, `-n` of `echo $a -n x` and `--version` of `/usr/bin/echo $a --version`; their known entries go. The corpus diff (test/snapshot.ts) is checked text by text, and the time of the corpus with every reader of `interpret` is measured. A CHANGELOG line under "Fixed", the examples in docs/changes/unreleased.md.
5. **The values and the options read the table.** A word whose role as written is a value or an option takes its readings from the table, and `valueHedges` goes. This fixes `$v` of `jq --arg $n $v .`, whose other words are read with `$n`'s count. The same tests and checks, Japanese included.
6. **Command runs and subcommands.** The words read by a command run or a subcommand get their readings from the shapes of the whole line: `nice $a -n 5 ls`, `sudo -u $u tar -cf x y` (the open item's `x`), `git $a log -n $b x`. The command token says when it runs nothing of its own ("when `$a` expands to nothing, `nice` reads `-n 5 ls` itself"). Cases added to the real test for `nice`, `timeout` and `sudo` (dry, as today). The same checks.
7. **The examples say what they assume** (section 2.10). Tests: the examples of the cases, and a corpus check that an example whose words keep the base class in every context has no such heading.

Step 1 can land at once. Steps 2 and 3 change no explanation, but step 2 already ties the counts, so steps 4 to 6 never say "when `$a`, `$a` expand to …". Steps 4 to 7 change texts and need a CHANGELOG line each.

## 5. Out of scope

- **The text of a field not known.** A word of unknown text is read as an operand, never as an option: `x='-r a'; cp $x d` is read as `-r` only when the model knows the value (#485). An unknown value that starts with `-` stays out; the pitfall on unquoted variables covers it.
- **A value written in its option's word** (`head -n$a f`): with `$a` empty, `-n` takes `f`. That needs to know whether a field is exactly its known start, not how many fields there are.
- **find's expression** (`find . -name $n -print`): src/embedded/find.ts reads it, not the interpreter.
- **Refusals the interpreter does not know** (`cp -t b`, `tr -d`: a missing operand): their roles are said, but not that the tool refuses (section 2.3). A spec field for the operands a form needs at least would mark them.
- **Counts tied in other ways** than the same lone expansion (section 2.2): `$a` and `$a/x`, `$a` and `"$a"`, `$@` and `$1`.
- **The model's own readers** of a command's words (`set $x`, `declare $x`, the environments of src/semantics/env.ts): the other open item after #485.
- **Elements of arrays and positional parameters** as fields the model knows: roadmap item 5.
- **Whole-line alternative readings in the panel** (alternative D).

## 6. For the maintainer

The steps assume these answers; each can change before its step.

1. **Sums of a run.** Say "when `$n` and `$v` expand to one word in all" rather than listing the pairs ("when `$n` expands to nothing and `$v` to a single word, or …"). Recommended: the sum.
2. **The budget of a word.** At most four clauses, counted after the grouping by profile; past them, the folded text. Recommended: four.
3. **A shape where the tool refuses the words** (an option `missing`, no form fitting). No clause covers it, rather than letting a clause hold there too. Saying the refusal on the command's token can come later. Recommended: no clause now, as #492.
4. **The examples.** A heading that says what they assume, rather than no example where a word they read changes role. Recommended: the heading.
5. **The cap.** 1,024 shapes (about 60 ms of readings) and 4,096 contexts of a word, past which the words say only that their roles may depend on the counts. Recommended: 1,024.
