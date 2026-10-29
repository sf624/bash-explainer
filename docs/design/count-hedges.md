# Hedges by word counts, read for every count at once

Status: planned (2026-10-30). The maintainer agreed to "a design document first, then steps that keep every test passing". No step started. The roadmap item is under "Now" in [../roadmap.md](../roadmap.md).

An unquoted `$a` may give no word, one word or several. The role of a word on the line can then depend on how many words `$a` gives: with `$a` empty, `tar -cf $a b` is `tar -cf b`, and `b` is the archive. The explanation says such roles under a condition ("value for `-f` when `$a` expands to nothing"); this page calls them hedges. Since #492, a hedge must hold for every count that meets its condition (oracles.md 2.8). The hedges read one word's count at a time, and read the options once. Several lines break that rule. This page shows the cases, proposes one design that reads every count of every such word together, and gives the steps.

## 1. The problem

### 1.1 How the hedges are read today

The argument interpreter (`interpret` in src/argv/interpret.ts) reads the words of a command with its spec. A word that may give other than one field has a `count` (`ArgWord.count`, from `countOf` in src/argv/words.ts): an unquoted `$a` is `{ min: 0 }`. The interpreter reads the line once with each word as one word (its fewest, one at least). That reading is `ArgvParse.roles`, which the explanation, the examples, the pitfalls and the idioms all read. The hedges are added to it, read only when the explanation asks for them (`withHedge`, and the `lazy` getters of src/argv/valuehedges.ts).

Two modules read the hedges, each in its own way:

- **The operands** (src/argv/hedge.ts, `hedges`). The options are already read. The operand patterns are matched again with other counts of the operand words: `several` (the word's own count), `byCount` (the count of one other word), `otherwise`, `mixed` (any counts of two or more words, said without conditions) and `none` (`Hedges.none`: the words that may give none giving none, every count of the others). The options are not read again.
- **The values** (src/argv/valuehedges.ts, `valueHedges`). An option's value that may give none or several is read again: the whole line without it (`without`, a "bare" reading), or with 2 to `mostWords(spec)` words of it (`spread`). This gives `none` and `more` on the words after it, and `rest` on the value. In each of those readings, every other word of the line gives one word.

So each hedge varies one word, or (in `Hedges.none` and `mixed`) the operands of one reading of the options. A condition on one word can then be contradicted by another word's count. A word whose role changes only because the options read differently (`tr $a -d`) gets no reading at all.

### 1.2 The cases

Each case below was run in bash 5.2.21 with the real tool (GNU coreutils 9.4, jq 1.7, glibc 2.39 getconf), in a cgroup, for each count of each variable. "We say" is the English explanation of main (5dd67b1d), from `npx tsx test/dump.ts`. The interpreter reads each written-out argv right in every case below (`interpret` on the words bash gives, rendered with test/support/argwords.ts). Only the hedges are wrong.

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

The role of `.` depends only on how many words `$n` and `$v` give in all (s): none, jq refuses; one, the value; two, the filter; three or more, a file.

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
| `NAME_MAX /` | `getconf NAME_MAX / -a` | the usage (status 2) |

We say of `-a`: "path (…) when `$a` expands to a single word; extra operand, … when it expands to more; variable (…) when `$a` expands to nothing". With `$a` empty, `-a` is the option.

**`nice $a -n 5 ls`** (a word that may give none in a command slot)

With `$a` empty, bash gives `nice -n 5 ls`: nice runs `ls` at niceness 5. With `$a` = `echo`, nice runs `echo -n 5 ls`, which prints `5 ls` (checked with `echo y` for `ls`). We say `$a` is the command ("runs `$a`"), and `-n` an option of `$a` ("Option (not in the dictionary; see `man `)"), with no hedge. The words after `$a` are read by the command it runs; with `$a` empty, they are nice's own.

### 1.3 What the cases have in common

The interpreter reads each argv right. The hedges go wrong because they read the line with one count changed at a time, and with the options fixed:

- Two words that may give none or several, in a row or apart, decide a later word's role together (`jq`, `cut`, `cp -t`).
- Where options end depends on the counts (`optionsFirst`: `tr`, `getconf`; a command slot: `nice`), but the options are read once.
- A value and an operand are hedged by two modules, which do not see each other's words (`cp -t $d $a b`).

Each fix so far (#482, #484, #487, #490, #492) added a reading for one more kind of word. The roadmap's open item lists more of the same: the words a command run reads after it (`sudo -u $u tar -cf x y`), and two words of one variable read as independent (`cp $a $a/x`). The fixes keep adding special cases, so this page proposes one reading for all of them.

## 2. The design

### 2.1 Count vectors

The **flexible** words of a command are those whose count is not exactly one: `count.min` 0, or `count.max` other than 1. A **count vector** gives each flexible word one count from its domain:

- 0, where the word may give none (`count.min` 0);
- its fewest (one at least) up to its fewest plus S, or its `count.max` where that is smaller.

S is the number of words past which every count reads the same. It is `mostWords` (src/argv/valuehedges.ts) of each spec the base reading visits (the command's, a subcommand's, a command run's), the largest of them: two, plus the most values one option takes, plus the longest operand pattern. Past it, every later word is past them all: a repeated item, an extra operand, an argument of a command run. The top count of a domain stands for "that many or more" where the word may give more. Today's two bounds (`span`, the longest pattern and one, in hedge.ts; `mostWords` in valuehedges.ts) become this one.

The **base vector** gives each word its fewest, one at least: the line as written. Its reading is `ArgvParse.roles`, unchanged. Every reader that does not ask for hedges (the examples, the pitfalls, the idioms, the semantic facts) keeps reading it.

### 2.2 One reading per vector

For a vector, the line is written out: a word with count c becomes c words, a word with count 0 disappears. The first word keeps what is known of the text (`value` or `prefix`); the others have no known text (`{}`), as `spread` does today. The whole line is read again with the spec: options, values, `--`, operands, subcommands, command runs. A reading for the roles only does not compute hedges of its own (the `bare` flag of today).

Words in a row whose known text is the same (none, for `$a $b`) give the same argv shape whichever of them gives how many (`cp $a $b`: `x y` and `z`, or `x` and `y z`). The readings are memoized by shape, as hedge.ts does with its runs (`kinds`, `readAt`). So the number of readings is the number of shapes, far below the number of vectors (section 2.6).

Each reading gives each word of the line its **signature**: the roles of the words it became, in order, with a role repeated in a row once (as `rolesAt` does today). A role is named by what tells two roles apart for a reader: an operand's role text without its parentheses (`roleText`), the value of an option (its flag and index), an option (its flag), a command or a subcommand, or "not named" (an operand of no form, `parse.unmatched`). This extends `ThenRole` and `sameRole` of valuehedges.ts with options and commands.

### 2.3 Classes and conditions

For each word, the vectors fall into **classes**: the vectors that give it the same signature. The class of the base vector is its role as written. The explanation says what the other classes are, each under a condition that holds for every vector in it.

A condition is a conjunction of at most two **atoms**. An atom is a set of counts, said with the phrases the texts already have:

- of one word: "expands to nothing" (0), "to a single word" (1), "to several words" (2 or more), "to n words" (n), "to n words or more" (n or more);
- of flexible words in a row, none with a known text (a run, as hedge.ts groups them): "expand to nothing" (all 0), and "expand to n words in all" (their sum). A role after a run depends on the sum only, as `mixedOf` reads today.

A clause "R when C" is said only where every vector that meets C gives R (it is **sound**). The clauses of a word together cover every vector whose signature is named and is not its base one (they are **complete**). For each class, the atoms and the pairs of atoms whose vectors all lie in the class are found, the largest are kept, and a greedy cover picks the fewest. With four flexible words and about ten counts each, that is about a thousand candidate conditions per word, each checked over at most 1,024 vectors; only words with a class other than the base one are covered.

A class that no conditions of two atoms cover is said without them: "X or Y, by how many words `$a`, `$b` and `$c` give" (the `mixed` text of today). Such a text names the roles but no condition, so it is sound and complete. The same holds for a word with more than four clauses: its clauses are folded into that text.

A vector whose signature has a role not named (no form fits, so the tool refuses the words) is in no class. No clause covers it; the explanation does not say what the tool does there. This keeps the rule of #492 (a reading that gives a role no hedge names makes the hedge claim nothing: `union` in valuehedges.ts), now per vector instead of per hedge.

### 2.4 What the explanation says

The token keeps its role as written first, then a clause per class. With the cases of section 1.2 (texts to be settled in the steps):

- `jq --arg $n $v .`, of `.`: "jq filter; value for `--arg` when `$n` and `$v` expand to one word in all; input JSON file when they expand to three words or more". (With both empty, jq refuses `--arg`; `.` is then its name, a value role, and the clause "name for `--arg` when `$n` and `$v` expand to nothing" can be said.)
- the same line, of `$v`: "value for `--arg`; with several words, the others are jq filter, then input JSON files; when `$n` expands to nothing, its words are name for `--arg`, value for `--arg`, jq filter, then input JSON files; when `$n` expands to two words or more, …".
- `cut -d $a -f $b f`, of `f`: "target file; value for `-f` when `$b` expands to nothing and `$a` to a single word or more".
- `cp -t $d $a b`, of `b`: "source; value for `-t` when `$d` and `$a` expand to nothing".
- `tr $a -d`, of `-d`: "target character set; option `-d` (delete the characters) when `$a` expands to nothing; extra operand … when it expands to two words or more".
- `getconf $a -a`, of `-a`: "path; option `-a` (print all variables …) when `$a` expands to nothing; extra operand … when it expands to two words or more".
- `nice $a -n 5 ls`, of `-n`: "argument of the command `$a` runs; option `-n` of `nice` when `$a` expands to nothing" (and `5`, `ls` the same way).

One field of the role replaces today's fields. `OperandRole` loses `uncertain`, `otherwise`, `by`, `several`, `byCount`, `mixed` and `none`; `ValueRole` loses `rest`; the other roles lose `none` and `more`. Each role gets one lazy field, `readings`: its base signature, its clauses (each a signature and its atoms), and the words of a folded text. `withHedge` and the `lazy` getters become one getter over one table per call of `interpret`, read when the explanation first asks. src/explain/operand-texts.ts renders the clauses; the phrases of today ("when it expands to 2 words", "its first word is …") stay where they fit.

The texts change only where today's are unsound or say less: a clause on one word that held for every count of the others reads the same. The corpus is checked before and after each step (`test/snapshot.ts`), and every changed text is checked against the table.

### 2.5 The examples

The examples (src/examples/, src/explain/examples.ts) read the base reading. They stay on it: an example shows the line as written, with each word one word. The table can tell when that matters: when a word the example reads (as data, as a program such as a jq filter, or as the file it reads) takes another role in another class. The example then says so in its heading ("with `$n` and `$v` one word each"). In `jq --arg $n $v .`, the output shown is that of the filter `.`; with `$n` empty and one word of `$v`, `.` is the value and jq runs its default filter, by chance the same. The example need not know that; it says what it assumes.

### 2.6 Bounds and cost

Measured on the snippets of the tests (test/fixtures/snippets.json, 1,860 snippets), with `argWord` (no model, so every unquoted expansion may give none; the explanation's `argWordIn` knows more, so these are upper bounds):

| What | Count |
| --- | --- |
| Commands with a spec | 1,700 |
| With a flexible word | 239 (1: 221, 2: 13, 3 or more: 5) |
| Count vectors per command, more than 256 | 4, all `echo` (up to 7.8·10^10) |
| Readings per command (distinct shapes) | median 5, 90th percentile 7, 99th 36, most 42 |
| Time to read them all, the worst command | under 7 ms |
| One `interpret` call (no hedges asked) | 0.03 ms |

The product of the domains blows up fast: 14 unknown words of `echo` give 7.8·10^10 vectors, though only a few shapes. So:

- **A spec whose roles cannot change** is not enumerated: every operand item has one role, no option takes a separate value, and there is no command slot, no subcommand and no `optionsFirst` (`echo`, `rm`: the check `roles.size === 1` of hedge.ts, widened). Words of unknown text are never read as options (section 5), so their counts change nothing there.
- **The vectors are capped at 1,024**, computed from the domains before any is read. Past the cap, the flexible words keep their base roles, and each word whose role may depend on counts says so without naming roles: "its role depends on how many words `$a`, `$b`, … give". That text is sound; the renderings check is taught to count it as a missing explanation, not a contradiction. No command of the corpus but `echo` has more than 256.
- The table is read lazily, once per call of `interpret`, and only the explanation asks for it, as today.

### 2.7 What folds into it

| Today | In the table |
| --- | --- |
| hedge.ts `several` | the clauses of a word on its own count |
| hedge.ts `byCount`, `otherwise` | the clauses on one other word's count |
| hedge.ts `mixed` | clauses on two words, or the folded text |
| `Hedges.none` (`noneOf`) | a clause with the atom "expand to nothing" on the words that drop |
| valuehedges.ts `none` | a clause "when `$a` expands to nothing", on any word after it, with the options read again |
| valuehedges.ts `more`, `rest` | the clauses on the value's count, of the words after it and of its own other words |
| `mostWords`, `span` | S (section 2.1) |
| the `kinds` runs and the cache of hedge.ts | the shape memo (section 2.2) |

hedge.ts and most of valuehedges.ts go. `mostWords`, `roleText`, `sameRole`, `thenRoles` and `allRoles` move to the table's module. `placeOperands` keeps only the base reading.

## 3. Alternatives

**A. Every vector, classes, conditions of at most two atoms (this page).** One reading of the whole line per shape. It covers the options, the values, the operands, the command runs and the subcommands with one rule, and its clauses are sound by construction. Its cost is bounded by the cap, and it is lazy. Its texts can be longer where two words interact; the folded text bounds them.

**B. Keep one count at a time, and say the assumption.** Each clause gets "(the other words one each)": "value for `-f` when `$b` expands to nothing (and `$a` to one word)". It costs nothing more. But a reader cannot tell what happens with both empty, so the explanation is silent on a vector it could read. The renderings check (every role of every vector shown) still fails there. It does not fix the options read once (`tr $a -d`, `getconf $a -a`, `nice $a -n 5 ls`): those need the line read again, which is A's reading. B is a wording, not a fix.

**C. Read counts symbolically.** Turn each spec into a grammar over argv shapes and solve for the counts (intervals, or Presburger formulas) instead of enumerating. Exact, with no cap. But the option parsers are procedures (getopt's permutation, `optionsFirst`, cobra's search, values taken from the next word, `--`), and every one would need a symbolic twin. That is a second interpreter, which semantics.md part A set out to avoid.

**D. Show whole-line readings as alternatives.** Group the vectors by the roles of every word at once, and show each class as a reading of the line ("Reading 1 of 3: when `$n` is empty…"). This tells the reader most, but the explanation is a token per word, and the panel has no place for alternative readings. It can be built on A's table later, if the panel redesign ([panel-redesign.md](panel-redesign.md)) wants it.

Recommended: A. It is the only one that fixes the cases of section 1.2, and the table it builds is what D would need.

## 4. Steps

Each step keeps every test passing, and lands as its own PR. The tests that compare with the real tools are in test/count-hedges-real.test.ts: each variable gives each count from none to four, the tool runs, and the explanation must allow the role of every word it gives (`showsRole`).

1. **The cases, as known contradictions.** Add the lines of section 1.2 to `CASES` in test/count-hedges-real.test.ts (`nice` with `seen` from what it ran; `getconf` with a directory named `-a`). The vectors whose roles today's texts contradict go in test/fixtures/count-hedges-known.json (line, counts, word, reason); the test fails on a contradiction not listed and on a stale entry, as test/fixtures/bash-ast-known.json does. No change in src/.
2. **The table.** A module src/argv/readings.ts: the domains and S, the vectors and the cap, the written-out line and its reading per shape, the signatures. Nothing reads it yet. Tests (test/readings.test.ts): the domains and the cap; the readings per shape; for every vector of the cases, the table's signatures equal the roles `interpret` gives the argv written out with the texts bash gives; over the corpus, every command's signatures at S equal those at S+1 and S+2 (the bound holds).
3. **The conditions.** The atoms, the cover and the folded text, in the same module, as data. Tests: for every command of the corpus and every word, the clauses are sound and complete over the table (a property test); the clauses of the cases of section 1.2, written out.
4. **The operands read the table.** A word whose base role is an operand takes its clauses from the table; hedge.ts goes. src/explain/operand-texts.ts renders the clauses, and test/support/renderings.ts reads the new phrases (the atoms on two words, the sums of a run). This fixes `b` of `cp -t $d $a b`, `f` of `cut -d $a -f $b f`, `.` of `jq --arg $n $v .`, `$f` of `jq --arg $n v $f`, `-d` of `tr $a -d` and `-a` of `getconf $a -a`; their known entries go. The corpus diff (test/snapshot.ts) is checked text by text. A CHANGELOG line under "Fixed", the examples in docs/changes/unreleased.md.
5. **The values and the options read the table.** A word whose base role is a value or an option takes its clauses from the table; `valueHedges` goes. This fixes `$v` of `jq --arg $n $v .`, whose other words are read with `$n`'s count. The same tests and checks.
6. **Command runs and subcommands.** The words read by a command run or a subcommand get their clauses from the readings of the whole line: `nice $a -n 5 ls`, `sudo -u $u tar -cf x y` (the open item's `x`). The command token says when it runs nothing of its own ("when `$a` expands to nothing, `nice` reads `-n 5 ls` itself"). Cases added to the real test for `nice`, `timeout` and `sudo` (dry, as today).
7. **The examples say what they assume** (section 2.5). Tests: the examples of the cases, and a corpus check that an example whose words keep their roles in every class has no such heading.
8. **One variable, one count.** Words that are the same lone unquoted expansion (`$a` and `$a`, with no assignment between them on the line) share one count, so `cp $a $a` reads no vector where they differ. Tests in the real test (`cp $a $a d`). `$a/x` and the like stay apart (section 5).

Step 1 can land at once. Steps 2 and 3 change no explanation. Steps 4 to 6 change texts and need a CHANGELOG line each; 7 and 8 too.

## 5. Out of scope

- **The text of a field not known.** A word of unknown text is read as an operand, never as an option: `x='-r a'; cp $x d` is read as `-r` only when the model knows the value (#485). An unknown value that starts with `-` stays out; the pitfall on unquoted variables covers it.
- **A value written in its option's word** (`head -n$a f`): with `$a` empty, `-n` takes `f`. That needs to know whether a field is exactly its known start, not how many fields there are.
- **find's expression** (`find . -name $n -print`): src/embedded/find.ts reads it, not the interpreter.
- **Counts tied in other ways** than the same word twice (step 8): `$a` and `$a/x`, `$a` and `"$a"`, `$@` and `$1`.
- **The model's own readers** of a command's words (`set $x`, `declare $x`, the environments of src/semantics/env.ts): the other open item after #485.
- **Elements of arrays and positional parameters** as fields the model knows: roadmap item 5.
- **Whole-line alternative readings in the panel** (alternative D).

## 6. For the maintainer

The steps assume these answers; each can change before its step.

1. **Sums of a run.** Say "when `$n` and `$v` expand to one word in all" rather than listing the pairs ("when `$n` expands to nothing and `$v` to a single word, or …"). Recommended: the sum.
2. **The budget of a token.** At most four clauses; past them, the folded text. Recommended: four.
3. **A vector where the tool refuses the words.** No clause covers it (strict), rather than letting a clause hold there too. Recommended: strict, as #492.
4. **The examples.** A heading that says what they assume, rather than no example where a word they read changes role. Recommended: the heading.
5. **The cap.** 1,024 vectors, past which the words say only that their roles depend on the counts. Recommended: 1,024.
