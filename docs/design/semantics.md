# Command specs and a semantic model of bash

Bash Explainer reads a script through its own syntax tree ([syntax-tree.md](syntax-tree.md)). Between that tree and the tokens it shows, two layers decide what each word *means*: the argument walk, which reads a command's words with its dictionary entry, and the analyzer, which says what each shell construct does. This page proposes to redesign those two layers, and to add a test that checks our tree against bash's own parser.

The parser, the renderers, the example runners, the dictionary texts and the tests stay.

## 1. Problem

Seven audits compared the explanations with bash 5.2, GNU tools and the GNU Bash Reference Manual.

- **Four error audits** (options, shell, builtins, embedded languages) found 65 explanations that contradicted the real tool: 13, 18, 16 and 18.
- **Three coverage audits** (syntax, expansions, builtins) rated 251 rules of the manual: 134 OK, 57 PARTIAL, 36 MISSING, 24 WRONG.

The errors are fixed now. But most fixes added a field to the dictionary types, or a `cmdName === '…'` branch in src/analyzer.ts. The causes fall into a few groups:

| root cause | count | examples |
|---|---|---|
| An option's arity is not one of the shapes the types know (optional and attached only, conditional on the next word, two values, a numeric or signal option) | about 20 | `date -Iseconds` split into `-I -s`; `journalctl -b -1`; `jq --arg n v`; `kill -TERM`; `nice -10`; `mapfile -O 2`; `read -N 5` |
| Operand roles are fixed, but depend on options and on how many there are | about 12 | `timeout 5 cmd` (5 was the command); `chmod --reference=r f`; `trap INT`; `getopts o v args`; `bash s.sh a b`; `kill -l 15` |
| Option meanings depend on a mode or were inherited wrongly | about 6 | `rpm -ivh` (said "info"); `kubectl logs -f` (said "filename"); `export -n` (said "nameref"); `unset -n` |
| How a command is run by another one | about 6 | `exec -a name cmd`; `bash -s -- a b`; functions under `sudo`, `ssh`, `su -c` |
| The execution environment | about 5 | `{ }` in a pipeline, after `&`, in a `coproc` said "current shell"; `exit` in `( )`; `cd` in `$( )` |
| Which expansions apply in a context | about 14 | `x=*.txt` shown as a glob; `case $x in $p)`; `~$user`; `${x:-~}`; `${a[$k]}` said "split"; `"$@"` said "one argument"; `[ -n $x ]`; `\b` in `=~` |
| Shell state along the script | about 7 | `shopt -s globstar` on the same line; `unset IFS`; `set -f`; aliases without `expand_aliases`; `x=1 export y` taken for a program; prefix assignments before special builtins in POSIX mode |
| Embedded languages (sed, awk, jq, printf examples) | about 18 | out of scope here: the example runners stay |

The code shows the same pattern:

- **The dictionary type has 19 special-case fields** (src/dict/types.ts): `arg`, `argCount`, `attachedOnly`, `nextIf`, `untilTerminator`, `fillsPositional`, `inMode`, `restOperands`, `values`, `lang`, `positional`, `positionalBy` (with `when`/`unless`/`last`), `positionalWith`, `positionalLang`, `wraps`, `wrapSkip`, `afterDashes`, `assigns`, `shellC`, plus `bundle`, `longSingleDash` and `subcommands`.
- **The argument walk is spread over 6 methods** of the `Analyzer` (`args`, `option`, `bundle`, `describeByCount`, `shellArgument`, `findArgs`) and 5 helpers, with 27 tests of a command's name (`set`, `echo`, `kill`, `su`, `trap`, `nice`, awk…).
- **The same facts are found in several places.** Whether code runs in a subshell is decided in four places (the `{ }` text, the pipeline pitfall, `IFS_SCOPES`, `afterAssignment`). Wrappers are known three times (`wraps` in the dictionary, `WRAPPER_PROGRAMS`, `SHELL_ONLY`), and `ssh`'s options twice (the dictionary and a table in `remoteNotes`).
- **Shell state is rebuilt on every `explainLine` call**, by scans of the tree and regular expressions on the text (`shoptStates`). Branches, subshells and functions are handled case by case.

So each new finding needs a new special case. The remedy is to describe commands as data, read by one interpreter, and to compute what bash does from the rules of the manual, once.

## 2. Goals and non-goals

Goals:

1. **One declarative spec per command**, read by one generic argv interpreter. Every special-case field and every command-name branch in the walk becomes data.
2. **A semantic model** between the syntax tree and the explanations. It follows the manual section by section. Explanations, notes and pitfalls are made from it, each with a pointer to its section.
3. **A differential test of the parser** against bash's own parser (bash-ast), over the whole corpus.
4. **Every step ships** with every existing test passing, and 100% coverage of `src/`.

Non-goals:

- **The parser** (src/syntax/), **the renderers** (src/ui/, cli/, web/), **the example runners** (src/examples/, src/embedded/) and **the token format** (`Token`, `LineExplanation`) stay. One optional field is added for the manual pointer (section 4.5).
- **The texts of the dictionary** stay as they are. They are moved into the new spec, not rewritten.
- **Other shells.** The model follows bash. POSIX mode is a mode of bash (6.11). ksh, zsh and dash keep the dialect checks of src/dialect.ts.
- **Running anything.** The model is static. What depends on run time is `unknown`, and the text says so.

Conventions stay. A subcommand is shown as a command, with a note that the shell sees an argument. Texts are written in our own words, never copied from man pages or the manual.

## 3. A: the command spec

### 3.1 Prior art

- **[withfig/autocomplete](https://github.com/withfig/autocomplete)** (MIT). A spec is a tree of `subcommands`, `options` and `args`. An option has `name` (a string or a list of aliases) and `args`. An arg has `isOptional`, `isVariadic`, `isCommand` (the rest is another command: `sudo`, `time`), `isScript`, and `optionsCanBreakVariadicArg`. Options have `isPersistent` (inherited by subcommands), `requiresSeparator` (`--opt=value` only), `isRepeatable`, `exclusiveOn` and `dependsOn`. `parserDirectives` set `flagsArePosixNoncompliant` (single-dash long options) and `optionsMustPrecedeArguments`. We take the vocabulary and the tree shape.
- **getopt_long** (glibc). An option has `no_argument`, `required_argument` (attached `-fFILE` or separate `-f FILE`; `--file=F` or `--file F`) or `optional_argument` (only attached: `-Ix`, `--iso-8601=x`). Short options cluster (`-xvf F`). GNU permutes operands and options unless the optstring starts with `+` or `POSIXLY_CORRECT` is set. `timeout`, `env`, `nice` and `xargs` use `+`, so their options end at the command. Long options may be abbreviated to a unique prefix. `--` ends the options.
- **zsh's `_arguments`**. `-o+` takes a value attached or separate, `-o=` with `=` or separate, `-o-` only attached. `*::cmd:_normal` hands the rest of the words to the completion of another command (the "command slot"), and `_precommand` marks wrappers. Exclusion lists say which options rule out others.
- **bash-completion** (GPL-2.0) restarts completion at a wrapped command with `_command_offset` (the idea only; no code is read or copied). **Python's argparse** matches `nargs` patterns to operands with a regular expression, as our matcher does (3.4).

### 3.2 Types

```ts
// src/argv/spec.ts
export interface CommandSpec {
  summary: Text;
  style?: 'gnu' | 'posix' | 'single-dash' | 'none'; // how options are written; default 'gnu'
  plusOptions?: boolean;                // `+x` turns off (`set +e`, `declare +x`)
  options?: OptionSpec[];
  patternOptions?: PatternOption[];     // `kill -TERM`, `-15`; `head -5`; `nice -10`
  modes?: ModeSpec[];                   // chosen by an option anywhere on the line (rpm -q)
  oldStyle?: OldStyleSpec;              // dashless letters in the first word (`tar cvzf`, `ps aux`)
  operands?: OperandAlt[];              // the first alternative that holds and fits
  dashDash?: 'end-options' | 'literal' | { then: OperandSpec[] }; // default 'end-options'
  subcommands?: Record<string, CommandSpec & { aliases?: string[] }>;
  subcommandPrefixes?: boolean | 'first'; // a prefix selects one: a unique one, or the first in order (`ip a` is `ip address`)
  operandParser?: 'find-expression';    // the escape hatch: a grammar patterns cannot express
  builtin?: 'special' | 'regular';
}

export interface OptionSpec {
  names: string[];                      // ['-f', '--file']
  text: Text;
  value?: ValueSpec | ValueSpec[];      // absent: none; a list: that many (`jq --arg NAME VALUE`)
  persistent?: boolean;                 // inherited by subcommands (`kubectl -n`)
  selects?: string;                     // the mode it selects (`-q` → 'query')
  inMode?: Record<string, Text>;        // its meaning in a mode (rpm: `-i` is info when querying)
  until?: { terminators: string[]; slot: CommandSlot }; // `find -exec … ;`
}

export interface ValueSpec {
  name: string;                         // shown as a placeholder: ‹FILE›
  text?: Text;
  how?: 'attached-or-next' | 'attached-only' | 'next-only'; // default 'attached-or-next'
  optional?: boolean;                   // getopt's optional_argument
  next?: RegExp;                        // optional: take the next word when it matches
  type?: ValueType;
  lang?: EmbeddedLang;                  // grep -e PATTERN
  values?: Record<string, Text>;        // set -o pipefail
}

export type ValueType = 'file' | 'dir' | 'number' | 'duration' | 'signal' | 'pid' | 'job' | 'user'
  | 'variable' | 'function' | 'arith' | 'pattern' | 'shell-option';
export interface PatternOption { pattern: RegExp; text: (m: RegExpMatchArray) => Text }
export interface ModeSpec { name: string; default?: boolean }
export interface OldStyleSpec {
  letters?: Record<string, OptionSpec>; // default: the command's `-x` options
  needs?: string;                       // at least one of these letters (the operation)
  style?: Text;
}

export interface OperandAlt { when?: Condition; pattern: OperandSpec[] }
export interface OperandSpec {
  name: string;                         // 'SOURCE', 'DEST', 'DURATION'
  text: Text;
  repeat?: '?' | '*' | '+';             // as in a regular expression; absent: exactly one
  type?: ValueType;
  lang?: EmbeddedLang;
  command?: CommandSlot;                // the words from here on are a command
  assignment?: boolean;                 // `NAME=value` for the command that follows (`env A=1 cmd`)
}
export type Condition = { option: string[] } | { mode: string } | { not: Condition };

/** How the words of a command slot are run (see 3.5). */
export interface CommandSlot {
  run: 'exec' | 'shell-string' | 'current-shell';
  where?: 'local' | 'remote' | 'container'; // default 'local'
  env?: 'exported' | 'reset' | 'none';  // what reaches it: exported variables, a clean set (`su -`), nothing
  lookup?: 'no-functions' | 'builtins-only'; // `command`, `builtin`
  replacesShell?: boolean;              // `exec cmd`: nothing after it runs
  joinsWords?: boolean;                 // ssh joins the words into one string for the remote shell
}
```

The interpreter's result is a list of roles, one per word or part of a word:

```ts
// src/argv/interpret.ts
export type ArgRole =
  | { role: 'option'; spec?: OptionSpec; flag: string; text: Text; cluster?: ArgRole[] }
  | { role: 'value'; of: string; spec: ValueSpec; index: number; attached?: Range }
  | { role: 'old-style'; letters: ArgRole[] }
  | { role: 'end-of-options' }
  | { role: 'operand'; spec?: OperandSpec; index: number }
  | { role: 'subcommand'; name: string; spec: CommandSpec; parse: ArgvParse }
  | { role: 'command'; slot: CommandSlot; words: SyntaxNode[] }
  | { role: 'unknown-option'; flag: string };

export interface ArgvParse {
  command: string;                  // 'git branch'
  mode?: string;
  roles: { node: SyntaxNode; part?: Range; role: ArgRole }[];
  /** Operands that matched no alternative (too many, too few): shown as plain words, with a note. */
  unmatched: SyntaxNode[];
}

export function interpret(spec: CommandSpec, words: SyntaxNode[], ctx: InterpretContext): ArgvParse;
```

The interpreter reads the *static* value of a word (`staticWordValue`): `-F'|'`, `"--file=x"` and `-d','` are options like their unquoted forms, with no special case. A word whose value is not known (`$opts`) is an operand of unknown role, and the walk goes on; a note says the shell decides at run time.

### 3.3 From today's fields to the spec

| today | spec |
|---|---|
| `'arg'` flag | `value: { name }` |
| `attached` (`attachedOnly`) | `value: { how: 'attached-only', optional: true }` |
| `next:<re>` (`nextIf`) | `value: { optional: true, next: /re/ }` |
| `arg2` (`argCount`) | `value: [{ name: 'NAME' }, { name: 'VALUE' }]` |
| `until` (`untilTerminator`) | `until: { terminators: [';', '+'], slot: { run: 'exec' } }` |
| `fills` (`fillsPositional`) | an operand alternative `when: { option: ['-e', '-f'] }` without the PATTERN operand |
| `inMode` | `modes` on the command, `selects` and `inMode` on the options |
| `restOperands` (`jq --args`) | an operand alternative `when: { option: ['--args'] }` |
| `values`, `lang` | `ValueSpec.values`, `ValueSpec.lang` |
| `positional` | `operands: [{ pattern: [..., { repeat: '*' }] }]` (the last repeats) |
| `positionalBy` (`count`, `orMore`, `when`, `unless`, `last`) | operand alternatives; counts come from the pattern (`SOURCE+ DEST`) |
| `positionalWith` (`kill -l 15`) | an operand alternative with `when: { option: ['-l'] }` |
| `positionalLang` | `OperandSpec.lang` |
| `wraps`, `wrapSkip` | an operand with `command: { run: 'exec' }` after the operands it skips (`DURATION`) |
| `afterDashes` | `dashDash: { then: [{ name: 'COMMAND', command: { … } }] }` |
| `assigns` | `{ name: 'NAME=VALUE', assignment: true, repeat: '*' }` before the command |
| `shellC` | `bash`'s spec: alternatives for `-c` (`COMMAND_STRING` with `command: { run: 'shell-string' }`, `NAME` as `$0`, `ARG*`), `-s` (`ARG*`) and the default (`SCRIPT`, `ARG*`) |
| `bundle` | `oldStyle` |
| `longSingleDash` | `style: 'single-dash'` |
| `subcommands` | `subcommands`, with `persistent` options inherited instead of spread (`...kube`) |
| `builtin` | `builtin: 'special' \| 'regular'` (POSIX's list of special builtins; see 4.3) |
| analyzer: options end at the first operand for builtins | `style: 'posix'` |
| analyzer: `echo` takes only `-n -e -E`, and `--` is text | `style: 'none'` with `patternOptions: [/^-[neE]+$/]`, `dashDash: 'literal'` |
| analyzer: `set +o`, `declare +x` | `plusOptions: true` |
| analyzer: `kill -TERM`, `-15`; `head -5`; `nice -10` | `patternOptions` |
| analyzer: `%1` job specs of kill, wait, fg, bg, disown | `type: 'job'` on the operands (a `%` word is a job, a number a PID) |
| analyzer: awk's `name=value` operands | an operand alternative `{ assignment: true }` for words that look like one |
| analyzer: `let` arguments are arithmetic | `type: 'arith'` |
| analyzer: `trap` first operand | pattern `ACTION? SIGNAL+` (3.4 gives `trap INT` its meaning) |
| analyzer: `su -`, `su -c` | a pattern option `-` and an option `-c` with `value: { lang: 'bash' }` and a `shell-string` slot |
| analyzer: `shellArgument`, `remoteNotes`' ssh table, `WRAPPER_PROGRAMS`, `SHELL_ONLY` | the specs of `bash`/`sh`, `ssh`, and every wrapper's `CommandSlot`; pitfalls from 3.5 |
| analyzer: `findArgs` | `operandParser: 'find-expression'` (the one escape hatch) |

### 3.4 The interpreter

`interpret(spec, words)` works in four passes.

1. **Split the words into options and operands.** Left to right, with the option grammar of `style`:
   - `--` ends the options (or is text with `'literal'`, or opens `dashDash.then`).
   - `--name=value` and `--name value` follow `ValueSpec.how`. A GNU-style long option may be a unique prefix of one name (`--pres` is `--preserve-status`); see 7.
   - `-abc` is a cluster. A letter with a value takes the rest of the word (`-n5`, `-F:`) or, at the end, the next word. An `attached-only` value takes the rest of the word, or nothing: `-Iseconds` is `-I` with `seconds`, and `-u -l` stays two options.
   - An optional value with `next` takes the next word only when it matches (`journalctl -b -1`).
   - `patternOptions` are tried before clusters (`kill -TERM`, `nice -10`).
   - `oldStyle` is tried on the first word only (on any word with `anywhere`, as procps does: see 3.7). A letter with a value takes the next unused word, in order (`tar cfC a.tar dir`).
   - With `style: 'posix'`, the first operand ends the options. With `'gnu'`, options may come after operands, except after a command slot, which ends them for this command. An `assignment` operand does not end them (`env -i A=1 cmd`).
   - The first operand that names a subcommand (or a unique prefix, with `subcommandPrefixes`) stops the split. The rest of the words are interpreted with the subcommand's spec, which inherits the `persistent` options.
2. **Choose the mode.** The first `selects` option on the line, in the order of `modes`, wins. Then each option's text is `inMode[mode] ?? text`.
3. **Match the operands.** Take the first alternative whose `when` holds and whose pattern matches the operands. A pattern matches as a regular expression over the list, with backtracking (greedy quantifiers, required items first):
   - `seq` is `FIRST? INCREMENT? LAST`. One word is `LAST`; two are `FIRST LAST`; three are all three.
   - `cp` is `SOURCE+ DEST`, or `SOURCE+` when `-t` is given.
   - `trap` is `ACTION? SIGNAL+`. `trap INT` is one signal, reset to its default.
   - An item with `command` ends the match. It takes all the remaining words as a command.
   Operands that fit no alternative go to `unmatched` and keep a plain explanation.
4. **Recurse.** A command slot is explained as a command. Its first word is resolved with the slot's `lookup` (4.3), and its spec is interpreted with the rest of the words. A subcommand is interpreted the same way.

The analyzer then turns roles into tokens, as today: an option token with its value as child, a cluster with one child per letter, and so on. Labels, spans and texts are unchanged.

### 3.5 What the command slot implies

Pitfalls come from the slot and from the resolution of its first word (4.3), not from lists of commands:

| slot | a function of the script | a builtin that changes the shell (`cd`, `export`, `read`…) | a builtin with a program of the same name (`echo`, `test`, `kill`) | `$X` in the words, `X` set by the wrapper |
|---|---|---|---|---|
| `exec` (sudo, env, timeout, nice, xargs, find -exec, nohup, chroot, flock, strace) | ⚠ not found: a separate program is started | ⚠ not found, or no effect on this shell | the program runs, not the builtin | ⚠ expanded by this shell first |
| `shell-string`, `env: 'exported'` (`bash -c`, `sh -c`) | ⚠ only after `export -f` (bash) | runs in the child shell; no effect here | builtin of the child shell | inside single quotes, the child expands it |
| `shell-string`, `env: 'reset'` (`su -c`, `sudo sh -c`) | ⚠ not there | as above | as above | as above |
| `shell-string`, `where: 'remote'` (ssh) | ⚠ not there | runs remotely | — | ⚠ unquoted words are expanded here, before sending |
| `exec`, `where: 'container'` (`kubectl exec`, `docker exec`) | ⚠ not there | ⚠ not found | the container's program | ⚠ expanded here |
| `current-shell` (`command`, `builtin`, `eval`, `time`) | `command f` skips the function; `eval` sees it | runs in this shell | the builtin | expanded once more by `eval` |

`exec cmd` adds `replacesShell`: the lines after it never run.

### 3.6 Worked examples

**timeout.** Options end at the command (coreutils uses `+` in its optstring).

```ts
timeout: {
  summary: t('Run a command with a time limit'), style: 'posix',
  options: [
    { names: ['-s', '--signal'], text: t('signal to send on timeout'), value: { name: 'SIGNAL', type: 'signal' } },
    { names: ['-k', '--kill-after'], text: t('send KILL if it still runs after this extra time'), value: { name: 'DURATION', type: 'duration' } },
    // --preserve-status, --foreground, -v (the options the audit found missing)
  ],
  operands: [{ pattern: [
    { name: 'DURATION', type: 'duration', text: t('time limit (`5`, `30s`, `2m`)') },
    { name: 'COMMAND', command: { run: 'exec' }, text: t('command to run') },
  ] }],
}
```

`timeout -k 5 10 sleep -h` gives `-k` with `5`, `DURATION` `10`, and the command `sleep -h` (the `-h` is sleep's: options ended). `timeout 5 myfunc` adds the pitfall of the `exec` row, because `myfunc` resolves to a function.

**rpm.** One option, two meanings, chosen by the mode.

```ts
rpm: {
  modes: [{ name: 'query' }, { name: 'verify' }, { name: 'install' }],
  options: [
    { names: ['-q', '--query'], selects: 'query', text: t('query installed packages') },
    { names: ['-i', '--install'], selects: 'install', text: t('install'), inMode: { query: t('show package information') } },
    // -l -p -v -h -U -e …
  ],
  operands: [
    { when: { mode: 'install' }, pattern: [{ name: 'PACKAGE_FILE', repeat: '+', type: 'file', text: t('package file') }] },
    { pattern: [{ name: 'PACKAGE', repeat: '*', text: t('package name') }] },   // and `-p`: a file
  ],
}
```

`rpm -ivh x.rpm` is install mode: `-i` installs and `x.rpm` is a package file. `rpm -qi bash` is query mode: `-i` shows information.

**tar, old style.**

```ts
tar: {
  oldStyle: { needs: 'cxtrudA' },    // letters default to the `-x` options
  options: [
    { names: ['-c', '--create'], selects: 'create', text: t('create an archive') },
    { names: ['-f', '--file'], text: t('archive file'), value: { name: 'ARCHIVE', type: 'file' } },
    { names: ['-C', '--directory'], text: t('change to this directory first'), value: { name: 'DIR', type: 'dir' } },
  ],                                 // and -x -t -v -z…; operands: FILE+ when creating, MEMBER* otherwise
  modes: [{ name: 'create' }, { name: 'extract' }, { name: 'list' }],
}
```

`tar cvzfC a.tgz /tmp src` gives the old-style word `cvzfC` with five letters; `f` takes `a.tgz` and `C` takes `/tmp`, in order; `src` is a file to add. `ps aux` uses `oldStyle` with letters of its own (BSD options), not its `-a -u -x`.

**kubectl exec --.**

```ts
const kubeGlobal: OptionSpec[] = [
  { names: ['-n', '--namespace'], persistent: true, text: t('namespace'), value: { name: 'NS' } },
  { names: ['--context'], persistent: true, text: t('kubeconfig context'), value: { name: 'CONTEXT' } },
];
kubectl: {
  options: kubeGlobal,
  subcommands: {
    exec: {
      summary: t('Run a command in a container'),
      options: [
        { names: ['-i', '--stdin'], text: t('pass stdin') },
        { names: ['-t', '--tty'], text: t('allocate a TTY') },
        { names: ['-c', '--container'], text: t('container'), value: { name: 'CONTAINER' } },
      ],
      operands: [{ pattern: [{ name: 'POD', text: t('pod') }] }],
      dashDash: { then: [{ name: 'COMMAND', command: { run: 'exec', where: 'container', env: 'none' }, text: t('command to run in the container') }] },
    },
    logs: { summary: t("Print a pod's logs"), options: [{ names: ['-f', '--follow'], text: t('stream the logs') } /* … */] },
  },
}
```

`kubectl -n prod exec -it web -c app -- ls *.log` gives `-n prod` (persistent, before the subcommand), the subcommand `exec`, the cluster `-it`, `POD` `web`, `-c app`, then the command `ls *.log` run in the container. The `where: 'container'` slot adds: ⚠ `*.log` is expanded here, against local files. `kubectl logs -f web` reads `-f` as `--follow` with no filter: subcommands no longer spread the options of `kubectl` (today `...kube`, from which the fix had to remove `-f`); only `persistent` options are inherited.

**git branch -m.** Subcommands nest, and the operands depend on the option.

```ts
git: {
  options: [{ names: ['-C'], text: t('run as if started in this directory'), value: { name: 'DIR', type: 'dir' } }],
  subcommands: {
    branch: {
      options: [
        { names: ['-m', '--move'], text: t('rename a branch') },
        { names: ['-d', '--delete'], text: t('delete a branch') },   // and -M, -D
      ],
      operands: [
        { when: { option: ['-m', '-M', '--move'] }, pattern: [
          { name: 'OLD', repeat: '?', text: t('branch to rename (default: the current one)') },
          { name: 'NEW', text: t('new name') }] },
        { when: { option: ['-d', '-D', '--delete'] }, pattern: [{ name: 'BRANCH', repeat: '+', text: t('branch to delete') }] },
        { pattern: [{ name: 'NAME', repeat: '?', text: t('branch to create') }, { name: 'START', repeat: '?', text: t('commit to start from') }] },
      ],
    },
  },
}
```

`git branch -m main` gives `NEW` = `main` (the backtracking leaves `OLD` empty). `git branch -m old new` gives both. `git remote add NAME URL` and `git stash pop` are subcommands of subcommands.

**journalctl -b.** An optional value taken from the next word only when it looks like one.

```ts
{ names: ['-b', '--boot'], text: t('only this (or the given) boot'),
  value: { name: 'BOOT', optional: true, next: /^([-+]?\d+|[0-9a-f]{32}|all)$/,
           values: { '-1': t('the previous boot') } } }
```

`journalctl -b -1 -u nginx` gives `-b` with `-1`, then `-u nginx`. `journalctl -b -u nginx` gives `-b` alone. `journalctl --boot=-1` takes the attached value.

### 3.7 As built

The code (src/argv/) differs from 3.2–3.4 in these points:

- Words are passed by index, as `ArgWord { value?, prefix?, count? }` (src/argv/words.ts makes them from the tree). `prefix` is the known start of a word whose value is not known (`--file=` of `--file=$f`). `count` is how many words it becomes (`{a,b}` 2, `*.txt` at least 1).
- Each word gets exactly one role. The words of a subcommand or a command slot are in that role's nested parse, which records where its words end (`end`).
- Added role kinds: `cluster`, `pattern-option`, `open-option` (`-$opts`), `terminator` (the `;` of `-exec`), `joined` (the words ssh joins) and `expression` (find). An attached value records its offset.
- Added spec fields: `longPrefixes` (decision 3; `'first'` for iproute2, below), `longEquals`, `shortEquals` (`dpkg-query -f=…`), `lastModeWins` (`echo -e -E`), `ValueSpec.command` (`su -c`), `OperandSpec.assignmentText` (awk `name=value`), `OperandSpec.option` (`flock FILE -c`), `OptionSpec.laterOperands` (`jq --args`), `marks`/`unlessMarked` (`kill -9 -1`), `OldStyleSpec.anywhere` (`ps -p 1 u`), `expressionSpec` (the spec of find's expression: all of its options, where the spec of `find` has only `-H`, `-L` and `-P`), and `SubcommandSpec`.
- `style: 'none'`: a word is an option only if all its letters are known options (`echo`, `let`).
- An assignment operand ends the options (`env A=1 -i cmd` runs `-i`; checked with the real env).
- A word that becomes known words (`a{,.bak}`) gives each its role (`each`). An operand whose role depends on how many words an expansion gives is `uncertain`, with the role it may have instead (`otherwise`), or the roles of its words when it gives several (`several`).
- There is no converter (A4): every dictionary entry is a `CommandSpec`. `cmd(ja, en, options, rest)` (src/dict/types.ts) builds it from options written as tuples (`OptSpec`, with the flags `arg`, `arg2`, `until`, `fills`, `attached`, `next:<re>`, `lang:<name>` and `persistent`) or as option specs, and from any field of a spec. `positional` (and `positionalLang`) is a shorthand for the last operand alternative: the operands in order, each optional, the last repeating; an option with `fills` adds an alternative before it without the first operand (`grep -e`). `byCount` and `lastIsDestination` write alternatives by count (`seq`, `cp`). The rules the old walk applied by name are in the entries: find's `operandParser` and `expressionSpec`, jq's `longEquals: false` and the `laterOperands` of `--args`, `head`'s and `tail`'s `countOption`, and awk's `assignmentText`. A tuple that gives a language or meanings of values without a value is an error when the dictionary loads.
- The flag `persistent` of a tuple (`persistent(list)`) becomes `OptionSpec.persistent`. A subcommand's own option of the same name wins over an inherited one (`kubectl logs -f`, `docker compose run -p`).
- A list of options names each option once: `mergeOptions` throws when a name is given twice in one list. It puts a second list over the first, whose names win: the options of src/dict/extrasFiles.ts and extrasAdmin.ts are merged so, with the entry's own options over them; extra subcommands do not replace the entry's. (A customCommands entry that names an option twice means what it says last.)
- `CommandSpec.program`: the spec of the program named like a builtin (coreutils `echo`, `printf`, `pwd`, `test`, `true`, `false`; procps `kill`). A path (`/bin/kill`) and a slot that starts a program (`env echo`, `sudo kill`) read the words with it, and get no pitfall; its options may differ (procps kill has no `-n` and no job specs, coreutils printf no `-v`).
- `CommandSpec.builtin` is the only mark of a builtin. The analyzer reads it for the kind of a command, for "(shell builtin)", and for the assignments before a special builtin in POSIX mode (until B3 builds `NameResolution` from it). It reads `plusOptions` for `declare +x` too.
- The builtins of src/dict/builtins.ts are written with `b` (regular, `style: 'posix'`) and `special`, and their operands with `args(...)`: each optional, the last repeating. `exit`, `return`, `shift`, `break`, `continue` and `logout` have `style: 'none'` (`exit -1` is a number). kill's signal patterns and marks, echo's modes and its literal `--`, and set's `next-only` `-o` are in their entries.
- The `bashExplainer.customCommands` setting is a spec in JSON (src/dict/custom.ts): `summary`, `style` (`gnu`, `posix` or `single-dash`), `options` as a list (`names`, `description`, `takesValue`), `operands` as a list (`name`, `description`, `repeat`) and `subcommands`. A text is the same in both languages. The shape of 0.6 (`options` as an object keyed by `-n|--dry-run`, and `arguments`) is converted when it is read, in 0.7 only. The rules that applied by name to a custom command named like a dictionary entry (`head -5`) are gone with the converter.
- A condition may look at an operand's value: `{ operand: 0, matches: /re/ }` (`trap 1 2`: a signal number first makes every operand a signal). A value not known matches nothing.
- `longPrefixes` and `subcommandPrefixes` take `'first'`: the first name in the list that the word starts selects it, as iproute2's `matches()` reads objects, their commands and its options (`ip a s`, `ip l s` is `link set`, `ip -b` is `-batch`); a `--` before an option name counts as `-`. The entries are written in the tool's order. `true` stays getopt_long's unique prefix, on for the wrappers whose option list is complete (timeout, nice, env, xargs, stdbuf, flock, sudo: test/wrappers-real.test.ts checks every long option of their `--help`, and that the prefixes they find ambiguous stay unknown).
- Small additions for the cases below. `PatternOption.inMode` gives a pattern option its text in a mode (`kill -l -15`: no signal is sent). `OperandSpec.values` gives meanings to particular operand values, shown in place of the operand's text (the dictionary writes "Shell option `x`: …" into them) (`shopt -o errexit`: the names of `set -o`). `OperandSpec.matches` lets only a word whose known text matches fit an item (a word not known fits). `CommandSpec.endsOptions` is a pattern for a word that is an operand and ends the options and old-style letters, so every word after it is an operand (`ps 1 u`: procps reads a bare number as a list of PIDs that ends the line; the alternative that matches a number first gives the later words an item that says they are an error). The condition `{ optionValue: ['-S'], matches: /re/ }` holds when an option was given with a known value that matches (`env -S'-i A=1' cmd`: a string of options and assignments leaves the command to the later words). An `unknown-option` role has `ambiguous`, the long options a prefix could be, when `longPrefixes: true` finds several (`timeout --v`). In the `'first'` mode a lone `-` starts every option, so it is the first one (`ip - 3 link` is `ip -loops 3 link`). `CommandSpec.shortClusters: false` makes a short option a whole word, with no cluster and no attached value (`git -pP`, `-C.` and `-c=x` are unknown); long options keep `--name=value`. `git` has it for its own options before the subcommand; the options of a subcommand are read with its own spec. An `env -S` string is judged by the pattern `SPLIT_OPTIONS_ONLY` (options, with their values, then assignments) and `-i` counts only before the first assignment. Limits: the string is not spliced into the words, so `env -S'A=1 B=2' -i printenv` (the later `-i` is the command, as env reads it) and two `-S` options are not modelled, and `-i` outside the string (`env -i -S'A=1' cmd`) is not joined with the string's own.
- `CommandSlot.env` adds `'variables'` (`sudo -E`: the variables, but no exported functions, which sudo's policy removes), and `escapesWords` (`sudo -s cmd`: each word is escaped before they are joined for the shell, so the words are read as a command). procps `watch` joins its words for `sh -c` (`shell-string` with `joinsWords`), and runs them as they are with `-x`.
- Slots compose along the wrapper chain: a command run through a slot gets only what each slot outside it passes on. The analyzer keeps the chain while it explains a wrapped command (`slotChain`), so `env -i bash -c f` and `sudo bash -c f` say that `export -f` does not help. B2's `ExecEnv` must be such a chain too, not a property of one slot: the environment, the functions, and where it runs (local, remote, container) are what every link passes on.

## 4. B: the semantic model

### 4.1 Where it sits

```
SyntaxTree ──► ScriptModel (src/semantics/) ──► Analyzer: tokens, notes, pitfalls ──► renderers
                 │ ShellState along the script
                 │ meanings of commands, words, redirections
                 └ uses interpret() of part A for each simple command
```

`buildModel(tree, shell, opts)` runs once per tree and is cached with it, so an `explainLine` call reads it and no longer rescans the script. The analyzer keeps the token layout (labels, spans, children, skeletons). It stops deciding meaning itself: it asks the model and renders facts (4.5).

### 4.2 Types

```ts
// src/semantics/model.ts
export interface ScriptModel {
  dialect: Dialect;
  commands: ReadonlyMap<SyntaxNode, SimpleCommandMeaning>;
  compounds: ReadonlyMap<SyntaxNode, CompoundMeaning>;
  words: ReadonlyMap<SyntaxNode, WordMeaning>;
  stateAt(n: SyntaxNode): { run: ShellState; parse: ShellState }; // before it runs; when its unit was read
  facts(line: number): Fact[];
}

export interface Dialect { shell: Shell; posix: Tri }   // posix: sh, `set -o posix`, `bash --posix`
export type Tri = 'on' | 'off' | 'unknown';

export interface SimpleCommandMeaning {           // manual 3.7.1
  node: SyntaxNode;
  assignments: AssignmentMeaning[];
  name?: WordMeaning;
  resolution: NameResolution;                      // 3.7.2
  argv?: ArgvParse;                                // part A
  args: WordMeaning[];
  redirections: RedirectionMeaning[];              // 3.6
  env: ExecEnv;                                    // 3.7.3
  status: StatusRule;                              // 3.7.5
  errexit: ErrexitContext;                         // 4.3.1
}

export interface AssignmentMeaning {
  name: string; subscript?: WordMeaning; op: '=' | '+=';
  value?: WordMeaning;                             // context 'assignment-value'
  scope: 'shell' | 'command-env' | 'persists' | 'local' | 'global'; // 3.7.1, 3.7.4, 6.11 (see 4.3)
  exported: Tri;
  special?: SpecialVariable;                       // SECONDS, RANDOM, IFS, GLOBIGNORE… (5.2)
  readonly?: boolean;                              // UID, EUID, or `readonly` earlier: the assignment fails
}

export type NameResolution =                       // 3.7.2, in bash's order
  | { kind: 'none' }                               // only assignments and redirections
  | { kind: 'dynamic' }                            // `$cmd`: decided at run time
  | { kind: 'alias'; def: AliasDef; expanded: boolean; why?: 'same-unit' | 'not-yet' | 'expand_aliases-off' }
  | { kind: 'function'; def: FunctionDef }
  | { kind: 'special-builtin'; name: string }      // 4.4: before functions in POSIX mode
  | { kind: 'builtin'; name: string; shadows?: 'program' }
  | { kind: 'external'; path: 'search' | 'given' }  // a name with `/` is not searched
  | { kind: 'not-found-here'; name: string; why: 'function-defined-later' | 'alias-unexpanded' | 'under-slot' };

export type ExecEnv =                              // 3.7.3
  | { kind: 'current' }
  | { kind: 'subshell'; why: SubshellReason; outer: ExecEnv }
  | { kind: 'child-process'; program: string };    // an external command, or a command slot's 'exec'
export type SubshellReason =
  | 'parentheses' | 'pipeline-stage' | 'background' | 'command-substitution'
  | 'process-substitution' | 'coproc' | 'shell-string';

export interface WordMeaning {                     // 3.5
  node: SyntaxNode;
  context: WordContext;
  steps: ExpansionStep[];                          // in bash's order: applies or not, where, and why not
  fields: 'one' | 'any' | 'one-or-error' | 'none-if-empty'; // how many words it can become
  value?: string;                                  // known when static
}

export type WordContext =
  | 'command-name' | 'argument' | 'assignment-value' | 'array-element' | 'declaration-argument'
  | 'cond-operand' | 'cond-pattern' | 'cond-regex'                    // [[ ]]
  | 'case-word' | 'case-pattern' | 'for-list'
  | 'redirect-target' | 'heredoc-body' | 'herestring'
  | 'arith' | 'subscript-indexed' | 'subscript-assoc'
  | 'param-word' | 'param-pattern';                                   // ${x:-word}, ${x#pattern}

export interface ExpansionStep {
  kind: 'brace' | 'tilde' | 'parameter' | 'command' | 'arithmetic' | 'process'
      | 'split' | 'glob' | 'pattern' | 'quote-removal';
  applies: boolean | 'unknown';
  parts: SyntaxNode[];                             // where it acts in the word
  why?: 'quoted' | 'context' | 'noglob' | 'ifs-empty' | 'posix-mode' | 'not-a-prefix';
  ref: ManualRef;
}

export interface ShellState {                      // 4.3, 6.6, 5
  set: Record<'errexit' | 'pipefail' | 'noglob' | 'nounset' | 'noclobber' | 'posix' | 'monitor', Tri>;
  shopt: Record<ShoptName, Tri>;
  ifs: { value: string } | 'default' | 'unknown';
  functions: ReadonlyMap<string, FunctionDef>;
  aliases: ReadonlyMap<string, AliasDef>;
  variables: ReadonlyMap<string, VariableFacts>;   // array, assoc, integer, nameref, readonly, exported, coproc
}

export type StatusRule =                           // 3.7.5, 3.2.3, 3.2.4
  | { kind: 'command' }                            // 127 not found, 126 not executable, 128+n signal
  | { kind: 'last-substitution' }                  // `x=$(cmd)`
  | { kind: 'pipeline'; pipefail: Tri; negated: boolean }
  | { kind: 'arith' }                              // (( )): 1 when the value is 0
  | { kind: 'last-run' }                           // compound commands, `return`/`exit` with no number
  | { kind: 'modulo-256'; value: number };         // `exit 256`
export interface ErrexitContext {
  active: Tri;
  ignoredBecause?: 'condition' | 'and-or-left' | 'negated' | 'function-in-condition' | 'substitution';
}

export interface CompoundMeaning { node: SyntaxNode; env: ExecEnv; status: StatusRule; errexitInCondition: boolean }
export interface RedirectionMeaning {                // 3.6
  fd: number | 'var'; op: string; target?: WordMeaning; // context 'redirect-target', 'heredoc-body', 'herestring'
  persists: boolean;                                 // `exec >log` with no command: for the rest of the script
  special?: '/dev/tcp' | '/dev/udp' | '/dev/fd' | '/dev/stdin' | '/dev/stdout' | '/dev/stderr';
}
export interface ManualRef { section: string; page: string; anchor?: string }   // '3.7.3', 'Command-Execution-Environment.html'
```

### 4.3 How the model is built

**Shell state.** One walk over the tree, in source order, carries a `ShellState`:

- `set`, `shopt`, `IFS`, `unset`, `alias`, `unalias`, function definitions and declarations change it. They are read through their `ArgvParse` (part A), not through regular expressions.
- A subshell gets a copy, dropped when it ends. A pipeline stage is a subshell unless it is the last one with `lastpipe` on and job control off.
- The branches of `if`, `case`, `&&` and `||` are walked from the same state, then merged: a value that differs becomes `unknown`. A loop body is walked once, then merged with the state before the loop.
- A function body is walked at each call, from the caller's state (decision 6). The walks are remembered by their entry state, and a recursive call is not walked again. Its locals and its temporaries (`x=1 f`) are restored when it returns. A function that no call reaches (or only calls from bodies no call reaches) is walked from its definition's state, with everything the script changes after the definition taken as `unknown`.
- **Parse time and run time differ.** bash reads a whole line, or a whole compound command, before running it. So `extglob` and aliases count from the next unit on, while `globstar`, `noglob` and `IFS` count from the next command. `stateAt` gives both.

**Dialect.** `posix` is on under `#!/bin/sh`, after `set -o posix`, and in `bash --posix`. It changes assignment scope (special builtins), tilde expansion after `=` in arguments, and the order of lookup (special builtins before functions).

**Name resolution** follows 3.7.2 in order: keyword (the parser already knows), alias (if expanded at parse time), special builtin in POSIX mode, function, builtin, then a program. A command slot's `lookup` and run mode restrict it: under an `exec` slot, only programs exist. This one rule gives the pitfalls of 3.5, `x=1 export y` (a builtin with a prefix, not a program), and `fc`, `bind`, `suspend` as builtins.

**Assignment scope** follows 3.7.1 and 3.7.4. With no command name, the assignments set shell variables. Before a special builtin in POSIX mode, they persist. Before any other command, they are in its environment only. Declaration builtins set shell variables, local in a function (`declare`, `local`), unless `-g`.

**Execution environment.** Each node's `ExecEnv` is computed from its ancestors, once (as built: 4.8). Here is where the four copies of "is this a subshell?" go. `exit` in a subshell exits only that subshell. `cd` and assignments in `$( )` do not leak. `$$` is the main shell's PID there, and `BASHPID` is not.

**Words.** A word's `steps` come from one table, keyed by context. It is the manual's 3.5 and the paragraphs that make exceptions to it:

| context | brace | tilde | param, cmd, arith | split | glob | other | manual |
|---|---|---|---|---|---|---|---|
| argument, for-list | yes | at the start; after `=` in bash mode | yes | unquoted | unquoted, unless noglob | `"$@"`: one word per parameter | 3.5 |
| command-name | yes | yes | yes | yes | yes | the first field is the name | 3.7.1 |
| assignment-value | no | at the start and after `:` | yes | no | no | `a=(…)` elements are arguments | 3.4 |
| declaration-argument | no (if it looks like an assignment) | as an assignment | yes | as an assignment | as an assignment | | 4.2 (declare) |
| cond-operand | no | yes | yes | no | no | | 3.2.5.2 |
| cond-pattern (`==`, `!=` right side) | no | yes | yes | no | no | unquoted parts are a pattern | 3.2.5.2 |
| cond-regex (`=~`) | no | yes | yes | no | no | unquoted `\x` becomes `x`; quoted parts are literal | 3.2.5.2 |
| case-word | no | yes | yes | no | no | | 3.2.5.2 |
| case-pattern | no | yes | yes | no | no | unquoted parts, also from `$p`, are a pattern | 3.2.5.2 |
| redirect-target | yes | yes | yes | yes | yes | not exactly one word: "ambiguous redirect" | 3.6 |
| heredoc-body | no | no | yes (unquoted delimiter) | no | no | `\` only before `$`, `` ` ``, `\`, newline | 3.6.6 |
| herestring | no | yes | yes | no | no | | 3.6.7 |
| arith | no | no | yes | no | no | a bare name is evaluated as an expression; empty is 0 | 6.5 |
| subscript-indexed | no | no | yes | no | no | arithmetic | 6.7 |
| subscript-assoc | no | no | yes | no | no | the key, as text | 6.7 |
| param-word (`${x:-w}`) | no | yes | yes | in the outer context | in the outer context | | 3.5.3 |
| param-pattern (`${x#p}`, `${x/p/r}`) | no | yes | yes | no | no | unquoted parts are a pattern | 3.5.3 |

Within a context, a step applies to a part unless the part is quoted, or state turns it off (noglob, an empty IFS). A tilde prefix that holds a quote or a `$` is not expanded (`~"root"`, `~$user`). The table is data (src/semantics/words.ts); each row carries its `ManualRef`.

**Status and errexit.** A pipeline's status is its last command's, or with pipefail the last non-zero one; `!` negates it. A list's is the last command run. `set -e` is ignored in the condition of `if`, `while` and `until`, left of `&&` and `||`, after `!`, and in all of a function called in such a context. In `$( )` it is off too in bash mode, unless `inherit_errexit` is set.

### 4.4 From the manual to the model

| manual | model |
|---|---|
| 3.1.2 Quoting | `ExpansionStep` `quote-removal`, and `why: 'quoted'` on the other steps |
| 3.2.3 Pipelines | `ExecEnv` `pipeline-stage` (lastpipe), `StatusRule` `pipeline` (pipefail, `!`, PIPESTATUS), `time` |
| 3.2.4 Lists | `StatusRule`, `ErrexitContext` `and-or-left`; `a && b \|\| c` is not if/else |
| 3.2.5 Compound commands | `CompoundMeaning`: env (`( )`), status, errexit `condition`; word contexts of `[[ ]]` and `case` |
| 3.2.6 Coprocesses | `ExecEnv` `coproc`; `VariableFacts.coproc` for `NAME` and `NAME_PID` |
| 3.3 Shell functions | `ShellState.functions`, `NameResolution` `function`, errexit `function-in-condition`, `return` status |
| 3.4 Parameters | `AssignmentMeaning`, special parameters, positional `$10` |
| 3.5.1–3.5.9 Expansions | `WordMeaning.steps`, by context (table above) |
| 3.6 Redirections | `RedirectionMeaning`: target context, fd table, no command, `exec` with only redirections, `/dev/tcp`, `/dev/fd/N` |
| 3.7.1 Simple command expansion | `SimpleCommandMeaning`: assignments, words, redirections; no name |
| 3.7.2 Command search | `NameResolution` |
| 3.7.3 Execution environment | `ExecEnv` |
| 3.7.4 Environment | `AssignmentMeaning.scope`, `exported` |
| 3.7.5 Exit status | `StatusRule` (126, 127, 128+n, modulo 256) |
| 4.1, 4.2 Builtins | part A specs; `builtin: 'special'` |
| 4.3.1 set, 4.3.2 shopt | `ShellState.set`, `ShellState.shopt`, `ErrexitContext` |
| 5 Shell variables | `SpecialVariable` (effects of assigning, read-only ones) |
| 6.5 Arithmetic | context `arith`; division by a literal 0 |
| 6.6 Aliases | `ShellState.aliases`, parse-time state, `expand_aliases` |
| 6.7 Arrays | `VariableFacts`, subscript contexts |
| 6.11 POSIX mode | `Dialect.posix`: special builtins, tilde after `=` |

### 4.5 Facts, notes and pitfalls

The model also lists **facts**: what a reader should know about a node. The analyzer renders them, in ja and en, from one catalog (src/semantics/messages.ts). (As built, 4.12: src/messages.ts, and the sections are plain section numbers.)

```ts
export interface Fact {
  id: FactId;                      // 'subshell-loses-changes', 'assignment-literal', 'ambiguous-redirect'…
  node: SyntaxNode;
  severity: 'meaning' | 'note' | 'pitfall';
  ref: ManualRef;
  params: Record<string, string>;
}
```

- A `meaning` goes into the token's explanation (`{ }`: "runs in a subshell, because it is a pipeline stage").
- A `note` goes into the notes with `ℹ`; a `pitfall` with `⚠`, as today. Pitfalls stay switchable with the `pitfalls` option.
- Each fact carries a `ManualRef`. `Token` gets an optional `refs?: ManualRef[]`, and notes a link to the manual page after their text: links in the hover and the panel, a section number in the CLI. The texts are our own words; the manual (GFDL) is cited by section and URL, never quoted.

src/pitfalls.ts and the pitfalls in the analyzer become facts of the model where they are semantic (pipe subshell, unquoted expansion, `local x=$(…)`). Those about style (`x = 1`, `==` in `[`) stay in pitfalls.ts.

### 4.6 The open PARTIAL and MISSING items

| audit group | covered by |
|---|---|
| syntax G1: `then`/`do` after a missing separator; `{echo` | not the model: a check on the tree (a keyword-shaped argument in a construct bash rejects), in src/dialect.ts's issues |
| syntax G2, builtins G1: prefix before a declaration builtin | `NameResolution` (builtin, not a program) and `AssignmentMeaning.scope` |
| syntax G3: `bash s.sh a b`, `bash -s -- a b`, `--posix` | part A: `bash`'s operand alternatives; `--posix` sets `Dialect.posix` for the slot |
| syntax G4: `exit` in `( )`, `cd` in `$( )`, `$$` vs `BASHPID`, coproc | `ExecEnv` |
| syntax G5: pipeline status, `return`/`exit` with no number, 126/127/128+n, `x=$(cmd) \|\|`, `a && b \|\| c` | `StatusRule` |
| syntax G6, builtins G7: `set -e` contexts | `ErrexitContext` |
| syntax G7: `export -f`, variables not exported to a child | part A (`-f` alternative: operands are functions); `AssignmentMeaning.exported` with a child `bash -c` that reads it |
| syntax G8, builtins G3: shebang options, POSIX mode | `Dialect`, `AssignmentMeaning.scope: 'persists'`, the tilde row of the table |
| syntax G9: `time { …; } 2>t`, `> file` alone, `$(<file)`, trailing `\` | `RedirectionMeaning` (no command; `$(<file)` reads the file); `time` as a pipeline fact; the `\` is a token of the scanner |
| expansions G1: tilde rules | the table: prefix rules, after `:` in assignments, after `=` in bash mode, in `param-word` |
| expansions G2: `case $p)`, `${x#$y}` | contexts `case-pattern` and `param-pattern` |
| expansions G3: arrays (`$a[1]`, `unset a[1]`, `arr=($(cmd))`, subscripts) | subscript contexts; `unset` operand type `variable` with a glob fact; `array-element` context |
| expansions G4: `x=*.txt`, `> $out`, unquoted `$(cmd)`, here-doc text, `{a}` | the table |
| expansions G5: arithmetic | context `arith`: bare name vs `$x`, unset is 0, division by a literal 0 |
| expansions G6: variables | data: the variable dictionary, with `SpecialVariable` for effects and read-only ones |
| expansions G7, builtins G5: `$10`, `exec` with redirections, `/dev/tcp`, `>&word` | parameter facts; `RedirectionMeaning` |
| builtins G2: aliases | `ShellState.aliases` with parse-time state; trailing-space aliases expand the next word |
| builtins G4: job specs, `fg` in a script | part A `type: 'job'`; `ShellState.set.monitor` |
| builtins G6: `test`, `[ "$a" > "$b" ]`, one-word tests | `test` reads its words with src/testexpr.ts like `[`; the `>` redirection inside `[ ]` is a fact |
| builtins G8: directory stack | part A specs (`pushd +N`); tilde `~N` in the table |

### 4.7 As built: the shell state (B1)

```ts
// src/semantics/state.ts
export type Tri = 'on' | 'off' | 'unknown';
export type OptionState = Tri | 'default';          // default: the script has not changed it
export interface ShellState {                       // immutable; a name not in a map is untouched by the script
  set: NameMap<OptionState>;                        // by long name: errexit, noglob, posix, monitor… (`set -G` is globstar in ksh)
  shopt: NameMap<OptionState>;
  variables: NameMap<VariableState>;                // { declared: Tri; set: Tri; attrs: { [letter]: { state: Tri; at } }; value?: string; at }
  functions: NameMap<FunctionState>;                // { state: Tri; def; exported: Tri; readonly: Tri }
  aliases: NameMap<AliasState>;                     // { state: Tri; value; at }
}
export interface StateModel {
  at(n: SyntaxNode): { run: ShellState; parse: ShellState; expand: ShellState };
  end: ShellState;
  assigned: ReadonlySet<string>;                    // the variables some command sets, wherever it runs
  definitions: { functions; aliases };              // every definition in the script, wherever it runs
}
export function shellState(tree: SyntaxTree, shell?: Shell, opts?: { posix?: boolean }): StateModel; // cached per tree and shell
export function lastStageInShell(st: ShellState, shell?: Shell): Tri;  // lastpipe, and job control off
```

- `NameMap` is a persistent map in 32 buckets that implements `ReadonlyMap`: a change copies one bucket, and comparing or merging two states visits only the buckets that are not shared. A 3,000-line script with 300 functions that call each other in loops takes about 0.7 s.
- `default` is apart from `off`: the analyzer says "not found before this line; fine if a file read with `source` turns it on" for `default`, and "may" for `unknown` (decision 5). A branch that turns an option to its default value, merged with one that leaves it alone, stays `default`.
- `run` is the state before the nearest statement that holds the node (a word has the state of its command). A node that runs more than once has the merge of its states (a loop, a function called with different states). `parse` is the state before the first top-level statement of the line or compound command that holds it (extglob). `expand` is where aliases come from: `parse`, but inside a command substitution, the state when the substitution runs (bash reads it again then). A function body's aliases are those of its definition. In a declaration, the state of an assignment has the attributes the declaration gives (`declare -i n=2+3` is an integer assignment).
- `declared` and `set` are apart: `declare x` and `local x` declare a variable that has no value (`set -u` fails on it). A name in capitals that the script declares without setting it may come from the environment: its `set` is `unknown`.
- A variable's value is kept when it is static text (with `-i`, `-l`, `-u` and `+=` applied; for `IFS` and `$x` pasted in arithmetic). Arrays have no value. Namerefs are followed, also in chains (with a guard against cycles): an assignment to `r` sets the variable it names, `unset r` unsets that variable, and `unset -n r` the nameref; an empty nameref takes the first name assigned to it.
- The branches of `if`, `case` (a `*)` branch makes the "no match" path impossible), `&&` and `||` are merged; a loop runs its body until the state at its start is stable (five passes at most), and may run it zero times (a `for` over known words runs it at least once). A name set on one path only is `unknown` after the merge, and so are its attributes.
- Function bodies run at their calls (decision 6, revised): from the caller's state, remembered by entry state (four walks with different states per function; after that, and for a recursive call or one more than 64 calls deep, the call takes what the body changed in its walks so far as `unknown`). `local` starts a local at that command (an assignment before it sets the outer variable); `declare -g` sets the global one; `local -` restores the set options; `unset` of a caller's local shows the outer variable again. Prefix assignments to a function (`x=1 f`) are its temporaries, in POSIX mode too. A function no call reaches is walked from its definition's state with what the script changes after the definition as `unknown`, so its notes say "may".
- Subshells (`( )`, `$( )`, `<( )`, `&`, coproc, pipeline stages but the last one with lastpipe on and job control off; in zsh and ksh the last stage is always in the shell) get the state and drop their changes.
- POSIX mode: `bash --posix` (and `#!/bin/bash --posix`) start with it and its shell options; sh, dash, ash, yash, ksh and mksh start with `posix` on. `set -o posix`, and setting `POSIXLY_CORRECT`, turn on expand_aliases, inherit_errexit and shift_verbose (`set -o posix` also sets `POSIXLY_CORRECT`); `set +o posix` and `unset POSIXLY_CORRECT` turn expand_aliases and shift_verbose off, when bash was in POSIX mode, as bash 5.2 does.
- Builtins are read through their specs, also behind `command` and `builtin` and after a prefix assignment (`x=1 declare y=2`, which the parser reads as a plain command). An alias that is expanded (expand_aliases on when its line was read, or in sh) runs its text: `alias e='set -f'; e`. bash keeps an indexed array indexed under `declare -A`, and an associative one under `declare -a`; a readonly variable or function keeps its value or definition; `set -a` exports scalars and functions, not arrays.
- Arithmetic assigns (6.5): `(( ))`, the arguments of `let`, the three parts of `for (( ; ; ))` (the condition runs before each pass and once more at the end), and `$(( ))` in words (of a command, an assignment, a test, a redirection, a `for` or `select` list, a `case` word or pattern).
  - Order: a simple command expands its words, then the values of its assignments, then its redirections (an assignment alone is made before them); a compound command makes its redirections first. An expression expands its `$x`, `${x}` and `$(( ))` first, then runs: `x=1; (( x = 3, y = $x ))` gives 1.
  - Some words may not be expanded, so what they assign may be: a `$(( ))` in an operand of `${…}`, the right side of `&&` and `||` in `[[ ]]`, a `case` pattern after the first. A program (not a builtin or a function, also behind `command`) makes its redirections in its own process, so what their words assign stays there; when the command's name is not known, it may.
  - The assignments run in bash's order (`&&`, `||` and `?:` skip a side when the condition is known, and give a merge when it is not), through namerefs and with the variable's attributes (`-i`, `-u`, `set -a`). A subscript is arithmetic unless the array is associative.
  - The value is kept when every operand is known: a constant (`010` is 8), `$x` pasting one, or a variable whose value is one. An unset or empty variable is 0; a name in capitals the script has not set may come from the environment, so it is not known. A variable's value is run as an expression where it is read (`y=x` reads `x`, `y='z = 4'` sets `z`), 32 levels deep at most (deeper, as a name that leads back to itself, is an error).
  - An error stops the expression, as in bash, keeping what it assigned before: an invalid constant (`08`), a value that is no expression, a division by 0, a negative exponent, a readonly variable, a missing operand. In `$(( ))`, it also discards the rest of the command (not the rest of the line, which bash also discards).
  - An argument of `let` that is not static text (`let "x = $y"`) sets the name it starts with, with no value.
- The analyzer and src/hosts.ts read the model: a Dockerfile RUN is read as its own script for `set -o pipefail`.

Not followed yet, each listed in the probe rows' `gaps` (where a row shows it): the conditions themselves (`if false` and `[[ 1 ]]` are branches like any other; `return`), the current directory (`cd`, `pushd`: `PWD`, `OLDPWD`), the rest of a line after an expansion error, the assignments of arithmetic outside `(( ))`, `let`, `for (( ))` and `$(( ))` (an index `${a[i++]}`, an offset `${s:i++}`, `[[ x -eq y=1 ]]`, the value assigned to an integer variable: `declare -i x; x='y = 1'`), `select`'s `REPLY`, the values that `read`, `mapfile`, `getopts`, `printf -v` and `${x:=w}` give (and whether getopts sets `OPTARG`), array values, positional parameters at calls (`local -n r=$1`), and the environment. `source`, `eval` and `trap` actions are not read.

### 4.8 As built: execution environments (B2)

```ts
// src/semantics/env.ts
export type SubshellReason = 'parentheses' | 'command-substitution' | 'process-substitution' | 'background' | 'coproc' | 'pipeline-stage';
export interface SubshellLink { kind: 'subshell'; why: SubshellReason; at: SyntaxNode; sure: boolean }   // sure: false on some paths only (lastpipe)
export interface SlotLink {                                                                              // `bash -c`, `sudo`
  kind: 'slot'; slot: CommandSlot; via: string; at: SyntaxNode;
  assigns: string[];                     // `env x=1`, `docker run -e x`; `*` for `--env-file`
  env: 'exported' | 'variables' | 'reset' | 'none';                       // the slot's, or the one its options give (`su -l -c`)
  shell?: 'bash' | 'sh' | 'dash' | 'zsh' | 'ksh' | 'unknown';             // the shell a string runs in
}
export interface CallSite { at: SyntaxNode; env: ExecEnv; sure: boolean }                              // sure: the function is defined there on every walk
export interface CallLink { kind: 'call'; def: SyntaxNode; sites: CallSite[]; unsure: boolean }        // a function body: where its calls run
export interface ExecEnv { links: readonly (SubshellLink | SlotLink | CallLink)[] }                      // outermost first; none: the main shell
export function processOf(env): { kind: 'main' | 'subshell' | 'shell' | 'program'; sure: boolean; link? };
export function whereOf(env): 'local' | 'remote' | 'container';
export function reachOf(env, shellopts?): { functions; variables; options; aliases: Reach; blocker?: SlotLink }; // Reach: 'all' | 'exported' | 'none'
export function slotEnvs(env, parse, spec, words, lookup?): Map<SyntaxNode, ExecEnv>;                  // the commands a command's words run, by first word
export function shellEffectOf(spec, roles): 'changes' | 'exits' | undefined;                            // what this call of a builtin does to its shell
// src/semantics/state.ts
interface StateModel { env(n: SyntaxNode): ExecEnv; calls: ReadonlyMap<SyntaxNode, ReadonlyMap<SyntaxNode, boolean>>; … }
```

- The design's `ExecEnv` (a `current` / `subshell` / `child-process` tree) became a flat chain: each link is a place where a new process may start, outermost first. A `$( )` in a pipeline stage is `[pipeline-stage, command-substitution]`; a string under `sudo env -i bash -c` is `[sudo, env, bash -c]`. `processOf` names the innermost link that starts the process (`( cd ) &`: the `( )`).
- The subshell rules are shared with the walk of B1, so that state and environment cannot disagree: `subshellReasons(n)` (the place in the tree) decides which statements drop their changes in the walk, and `lastStageInShell` reads lastpipe and `set -m` from the state where the pipeline runs (with the state merged over every walk of it: "may" when they differ).
- The walk records the calls of each function (`calls`), with whether the function is surely defined there. A call through an alias, a static `eval` string (`eval f`, `builtin eval f`) or a trap's action (`trap f EXIT`) is recorded on that command; the walk runs the string for its calls only, and drops what it changes. A body's chain is a `call` link with the places it is called from (`sites`): `processOf` says "subshell" when every site is in one, and "may" when only some are. Functions that call each other (a strongly connected component of the call graph) run where the component is entered from outside, with the subshells around the calls inside it on top (`f() { g | cat; }`). The link is `unsure` when the function's name is a word more often than the walk saw calls (`"${1:-f}"`, `bash -c f`, `command f`), or when no call is seen: then the chain is where it is defined, and the process is "main" but not for sure.
- Slot links come from the argument interpreter: `slotEnvs` reads the nested parses (subcommands, find's actions) of a command and gives each command a slot runs the chain to it. `CommandSlot.envWith` changes what a slot passes with an option (`su -c` keeps the environment; `su -l -c` does not), and `ValueSpec.setsEnv` marks the options that give the command a variable (`docker run -e x`, `--env-file`). The analyzer asks `slotEnvs` once per command and renders the pitfalls of a slot from its environment: whether a function or a variable reaches the command (`reachOf`, with the first link that blocks it), and where it runs. `reachOf` also says whether the set options (only with an exported `SHELLOPTS`) and the aliases reach it, for B3 and B5. `slotChain`, `functionBlocker` and the analyzer's `via` are gone, and so are the four subshell checks (`groupSubshell`'s walk, the pipeline pitfall's lastpipe test, the `$_` scan's list of subshell types, and the walk's own `&` and pipeline tests).
- The explanations it gives: a call of a builtin that acts on its shell says that it acts on the subshell only, with the reason. `CommandSpec.shellEffect` gives `changes` or `exits`, and a predicate over the call's options and operands for the builtins whose other forms only print (`set +o`, `umask`, `trap -p`, `declare -p`, `alias name`, `shopt -p`, `hash -t`, `ulimit -n`). In `$( )` and `<( )` the change is said mildly, as it is usually there for the commands after it (`$(cd dir && pwd)`). `$$` in a subshell is still the script's PID. A string run by another shell that reads a variable of the script the shell does not get (not exported, or a link passes none: `env -i`, sudo, `su -l`, a container, ssh) is a pitfall. The string is read with the parser and the state model: a variable it has set before the read does not count, nor does a read with a default or a length (`${x:-d}`, `${#x}`).
- test/env-probes.test.ts compares the model with every row of `env.json` (43 rows): a marker is a call of an exported function, so the model says `not-run` where a function cannot run (a program, `command f`, a shell that gets no exported function). Every marker agrees with bash but three, listed in the rows' `gaps`, where the model says "may": it does not evaluate conditions (lastpipe turned on in an `if`; a function that returns before the marker on one path), and it does not read the string of `bash -c f`. test/probe.test.ts runs bash on every row again in CI (bash 5.2 on ubuntu-24.04), so the table cannot go stale.

Not followed yet: what runs inside a string (`bash -c 'a | b'`, `( eval 'cd /x' )`, `echo | eval 'exit 1'`: the string is not read for its environment, and the analyzer does not explain it as a script), the commands that never run after `exec cmd`, sudo's policy (`env_keep`, `-E` with a policy that keeps functions), a shell that is not bash (`SlotLink.shell` says which; `export -f` reaches only bash: B3), and the state changes of an `eval` string or a trap action.

### 4.9 As built: words (B4)

```ts
// src/semantics/words.ts
export type WordContext = 'command-name' | 'argument' | 'assignment-value' | 'array-element' | 'declaration-argument'
  | 'cond-operand' | 'cond-pattern' | 'cond-regex' | 'case-word' | 'case-pattern' | 'for-list'
  | 'redirect-target' | 'heredoc-body' | 'herestring' | 'arith' | 'subscript-indexed' | 'subscript-assoc'
  | 'declaration-assignment' | 'param-word' | 'param-pattern';
export const CONTEXTS: Record<WordContext, ContextRule>;  // { brace, tilde, split, glob, match?, fields, posixLiteral?, manual }
export const STEP_MANUAL: Record<StepKind, string>;       // brace 3.5.1 … quote-removal 3.5.9; a step's `manual` is 6.11 when POSIX mode is why
export interface WordFailure { kind: 'fatal' | 'command'; applies: true | 'unknown' }   // for B5
export interface WordMeaning {
  nodes: SyntaxNode[];            // one, but the parts of the right side of `[[ x == $p* ]]`
  context: WordContext; rule: ContextRule;
  steps: ExpansionStep[];         // brace, tilde, parameter, command, arithmetic, process, split, glob, quote-removal
  tildes: TildePrefix[];          // the prefixes bash expands, with `after: '' | '=' | ':'`
  ifs: IfsState; glob: GlobState; // where it runs: IFS, and noglob, nullglob, failglob, dotglob, nocaseglob, extglob, globstar, GLOBIGNORE
  posix: Tri; state: ShellState;
  value?: string;                 // after quote removal, when nothing in it expands
  failure?: WordFailure;          // how bash may fail on it whatever the values: set -u, ${x:?}, failglob (fatal); a redirection target (command)
}
export function wordOf(n): { nodes; context } | undefined;   // the word that holds an expansion, a string, a word
export function wordMeaning(n, model: StateModel): WordMeaning | undefined;   // cached per model
export function partMeaning(part, model): { word; quoted; split: ExpansionStep; glob: ExpansionStep } | undefined;
export function wordFields(n, model, env?: WordEnv): { fields?: string[]; error?: 'ambiguous-redirect' | 'no-match' | 'unbound' | 'parameter-null'; failure?: WordFailure };
```

- `ExpansionStep.applies` is `true`, `false` (with `why`: `context`, `quoted`, `noglob`, `ifs-empty`, `posix-mode`, `braceexpand-off`) or `unknown` when the state it depends on is unknown (`set -f` on some paths, an IFS set to a value not known here, POSIX mode on some paths). The analyzer says "may" then.
- The rows differ from the table of 4.3 where bash does: an array element has a tilde at its start only (`a=(x=~/y)` keeps it); a declaration word that the parser does not give as an assignment (`declare "c"=$x`) is an argument, split and globbed; a redirection target is neither split nor globbed in POSIX mode, but its braces expand; the operands of `${…}` (`param-word`) are split and globbed as the expansion around them. The subscript rows are one (`subscript`): the steps are the same.
- Tildes (one scan, `tildeSpots` in src/staticword.ts, which `staticWordValue` uses too): at the start of a word; in an assignment, also after each unquoted `:` in any plain part (`PATH=$PATH:~/bin`); in a word that looks like an assignment, after the `=` and each `:`, in bash mode only, in an argument, a `for` list, `case`, `[[ ]]` and a redirection target (not in a here-string, an array element or the word of `${u:-…}`); in a declaration's assignment, in POSIX mode too. `x=1 declare y=$v` is a declaration for bash (`declaration-assignment`), `x=1 command declare y=$v` is not. A prefix that is not all in the plain word (`~"x"`, `~$u`, `{~\x,y}`) is not one.
- A subscript is `subscript-assoc` when the array is associative where the word runs, else `subscript-indexed` (arithmetic). The offset and length of `${x:o:l}`, and a word in `$( (( )) )`, are `arith` (the nearest of arithmetic, `$( )` and `${ }` decides).
- `wordFields` gives the fields when they follow from what the model knows: quotes, brace expansion of a plain word, tildes, `$x` and `${x}`, `${#x}`, `${!x}`, `${x:-w}` and the other defaults, `${x:o:l}`, `${x#p}` and `%`, `${x/p/r}` (not with an unquoted `&`), `${x^^}` and `,,`, constant arithmetic, word splitting with the IFS in effect, and pathname expansion with the options in effect. What the model does not know, it gives as unknown: positional parameters, arrays, namerefs, command output, arithmetic with names, the user database (`~user`). A variable assigned by arithmetic or `${x:=w}` in the statement that holds the word (also through the substitutions around it) is unknown too, since the state there is the one before the statement (`echo $(( i++ )) $i`). The environment, the current directory and the files are inputs (`WordEnv`): the analyzer gives none, the probes give bash's. Pathname expansion follows dotglob, GLOBIGNORE, nocaseglob, extglob, globstar (`dir/**` and `./**` give the directory too), globskipdots (`.` and `..` when off), nullglob and failglob; a `./` before the pattern is kept, and a path through `.` or `..` is unknown. A script that runs `cd`, `pushd` or `popd` anywhere has `~+`, `~-` and its globs unknown (the directory is not followed). nocasematch makes `${x/p/r}` ignore case (not `#` and `%`: bash does not).
- A variable whose value is not static text has its `source` in the state (4.7): the value word of the plain assignment that set it, on every path to here (a merge keeps it only when both sides have the same one). `wordFields` expands that word where it ran (`w=$z`, `declare y=$x`, `PATH=~/bin:$PATH`), with a guard against cycles, a cache per model, environment and word, and a depth of 32 (deeper is unknown).
- The analyzer says it of each word the same way: an unquoted expansion in `case`, `[[ == ]]` or `[[ =~ ]]` is read as a pattern or a regex (`match`); a glob word and an expansion on a line where `set -f` is on some paths only both say globbing may be off.
- The state model changed with it: an assignment's static value keeps globs and braces as text (`x=*.txt` is `*.txt`); a GLOBIGNORE that is not empty turns dotglob on and `unset GLOBIGNORE` turns it off, as bash does (an empty GLOBIGNORE leaves it), also when a `local GLOBIGNORE` goes out of scope; `declare "c"=$x` declares `c`, with a value not known here.

Deferred: `${x}` and unquoted `$(…)` do not say yet that they are split (only `$x` does); arrays and positional parameters in `wordFields` (B1 does not follow their values); the shells other than bash (zsh does not split an unquoted `$x`); case-insensitive matching (`nocasematch`) and the pattern of `[[ == ]]` and `case` as a fact of the model (the analyzer still reads it from the tree); a glob in a word that also has a tilde after `=` (`a[1]=~/e` is explained for its tilde only); `valueNote` reading the model's `value`.

### 4.10 As built: names and assignments (B3)

```ts
// src/semantics/names.ts
export type NameResolution =
  | { kind: 'keyword'; name }                                                  // unquoted, where the parser has not read a command name yet
  | { kind: 'alias'; name; alias: AliasState; sure; target?: NameResolution; otherwise?: NameResolution }
  | { kind: 'function'; name; fn: FunctionState; sure; shadows?: 'builtin' | 'program'; otherwise?: NameResolution; missed?: Missed }
  | { kind: 'builtin'; name; special: boolean; disabled?: CommandEntry; missed?: Missed }  // disabled: `enable -n` on some paths
  | { kind: 'file'; name; path: 'search' | 'given' | 'hashed'; known: boolean; hashed?: CommandEntry; disabled?: CommandEntry; missed?: Missed }
  | { kind: 'none'; name; why: 'not-a-builtin'; missed?: Missed };             // `builtin x`
export interface Missed { kind: 'function' | 'alias'; def: SyntaxNode; why: MissReason; by?: SyntaxNode; slot?: SlotLink }
// MissReason: later, same-unit, subshell, in-function, unset, expand_aliases, command, builtin, posix-special,
// program, not-exported, not-passed, not-imported
export function resolveName(model: StateModel, name: string, at: SyntaxNode, opts?: { shell?; quoted?; command?; lookup?; env?: ExecEnv; program?: (name) => boolean }): NameResolution;
export interface AssignmentMeaning { node: SyntaxNode; name: string; scope: 'shell' | 'command' | 'persists'; sure: boolean }
export function assignmentsOf(model: StateModel, command: SyntaxNode, res: NameResolution | undefined): AssignmentMeaning[];
export function definitionFails(model: StateModel, def: SyntaxNode): Tri;   // a function named like a special builtin in POSIX mode
// src/semantics/state.ts: ShellState gets `disabled` (`enable -n`) and `hashed` (`hash -p`; assigning PATH, `hash -r`
// and `hash -d` forget), and FunctionState `removed` (the `unset -f`).
```

- The order is bash's (3.7.2): a reserved word, an alias, a special builtin in POSIX mode, a function, a builtin, a path of `hash -p`, then PATH. Each step reads the B1 state at the name's place: aliases from `expand` (with expand_aliases there; always in sh and the other shells), the rest from `run`. A step that is true on some paths only gives `sure: false` and what runs on the others (`otherwise`), so the analyzer says "may" (decision 5).
- `Missed` is the definition a reader may expect that does not run here, and why: a function defined later, in a subshell (`( )`, a pipeline stage), inside a function that has not run, or removed; an alias that bash does not expand (expand_aliases off), that is read in the same unit as its definition, or after `unalias`; a function skipped by `command`, `builtin`, a program started by a slot (`sudo f`), or POSIX mode (a special builtin first). The analyzer renders each as a note on the head token.
- Where it runs comes from B2 (`opts.env`): under an `exec` slot only files run; under `command` and `builtin` (`CommandSlot.lookup`) no alias or function; in a string run by another shell, a function of the script runs only when every link passes the exported functions (`reachOf`), it is exported, and the shell reads them: bash does; dash, zsh and ksh do not; `sh` may be dash (`sure: false`). That shell's builtins are bash's when it is bash (or not known).
- A body that runs later than its place in the text (a function no call reaches, a trap's action) is walked with what the script changes after it taken as unknown, except the functions that the top level surely defines: by a top-level statement of the main shell (or the first of a top-level list, `f() { …; } && complete -F f x`), not in a branch, a subshell or a function, and never named by `unset`. Those are defined there, so a library file or a dispatch script calls them without "may". A trap's action runs after the top level: an EXIT trap set at the top level with the state at the end, any other from its state widened so. When a function is still only on some paths, `maybe` says why: a definition before the call is on some paths (`branch`), or the only ones come after it in the text (`later`).
- After a `source` or `.` (its file is not read), a name the dictionary does not know may be a function of that file: the file resolution has `sourced`, and no "defined later" reason is given. A `source` counts before a command after it in the text, and anywhere for a command in a function body.
- A function named like a declaration builtin or `unset` (which the parser reads as their own nodes) runs instead of them: the walk calls it, and the analyzer explains the line as its call. In POSIX mode, a special builtin is found first, so `export`, `readonly` and `unset` stay the builtins there. A quoted name that an alias would expand gives `Missed` with `quoted` (for the manual's 3.1.2). `PATH=… cmd` looks the name up with that PATH and empties the table of `hash -p`, for good.
- `StateModel` also gives `sources` (the `source` and `.` commands run) and `unit(n)` (the first statement of the unit bash reads at once that holds `n`).
- The model does not know the file system: a name that is none of the others is a file to search, `known` when the dictionary describes a program of that name (or the builtin turned off has one: `enable -n echo` runs coreutils echo). A name with a slash is a path.
- `AssignmentMeaning`: with no command, a shell variable; before a name that may expand to no word (`x=1 $cmd`), `command` but not sure; before a special builtin with POSIX mode on, it stays (exported), `sure: false` when POSIX mode is on on some paths; otherwise it is in the command's environment only. bash 5.2 keeps it temporary before a function, `command` and `builtin` in POSIX mode too (state.json has the rows).
- In POSIX mode a function cannot have a special builtin's name: bash says "is a special builtin" and stops the script (dash: "Bad function name"). The walk does not define it, and the analyzer gives a pitfall at the definition.
- The analyzer's `commandHeadFor` renders the resolution: the function (with what it hides, and "may"), the alias (with its chain), a builtin turned off or a hashed path as the program it runs, and the missed definitions as notes; `wrapped` says what `command` and `builtin` skip; the pitfall of a function in a string run by another shell reads the resolution. The prefix assignments render `AssignmentMeaning`. `functionAt`, `calledFunction`, the analyzer's alias lookup and `unitOf` are gone, and so are `head.name === 'test'` (the specs of `test` have `operandParser: 'test-expression'`), the regular expressions of `unset` (its words are read with its spec, in the analyzer and in the walk), the choice of the declaration flag tables by name (each option of the declaration specs has its text, and `offText` for `declare +x`), and the special-builtin check of the prefix assignments.
- test/names-probes.test.ts compares `resolveName` with every row of names.json (28 rows; `type -t` under bash and `bash --posix`), and `AssignmentMeaning` with the rows of state.json that have prefix assignments. The differences are in the rows' `gaps`: `type -t` itself (it looks up aliases before reserved words, finds the function before a special builtin in POSIX mode, and sees an alias the same line defined, which the commands of that line do not use), the file system (`./a.txt` is not executable), conditions (`if false`), values not known (`PATH=$HOME/bin`), and a script that `bash --posix` stops. test/names.test.ts tests what `type -t` cannot show (`command`, `builtin`, slots, other shells) and the texts; each was checked with bash 5.2 and dash.

Not followed yet: trailing-space aliases (`alias s='sudo '; s ll` expands `ll`), an alias that defines a function (`alias e=echo; e() { …; }` defines `echo`), `enable -f` and `-d` (loadable builtins), `hash` without `-p` (it only fills the table), whether PATH finds a program after the script changes it, `command -p` (the default PATH), the builtins of shells other than bash (dash is taken to have bash's, but `shopt`, `mapfile` and `readarray`), what a sourced file defines (only that it may define functions), a function defined after a body but in a subshell or a branch ("may": the walk does not tell subshell changes apart when it widens), and `local` outside a function written after a prefix assignment (`x=1 local y`, which the parser reads as a plain command: no pitfall).

### 4.11 As built: status and errexit (B5)

```ts
// src/semantics/status.ts
export type StatusRule =
  | { kind: 'command'; functions: SyntaxNode[] }          // its own (a function's, from B3's resolveName: the definition)
  | { kind: 'last-substitution'; at?: SyntaxNode }        // only assignments: the last `$( )`, 0 without one
  | { kind: 'masked'; by: string; substitutions: SyntaxNode[] } // `local x=$(cmd)`: the builtin's status
  | { kind: 'pipeline'; stages: SyntaxNode[]; pipefail: Tri; negated: boolean }
  | { kind: 'arith' } | { kind: 'test' }                  // `(( ))`, `let`; `[[ ]]`, `[ ]`
  | { kind: 'last-run' }                                  // lists, compound commands, `time`
  | { kind: 'given'; by: 'exit' | 'return'; value: number } | { kind: 'previous'; by: 'exit' | 'return' }
  | { kind: 'wait'; job?: SyntaxNode; all: boolean }      // `wait $!`: the job `$!` names
  | { kind: 'background'; job: StatusRule }               // `cmd &`, coproc: 0
  | { kind: 'definition' };
export interface Ignored { why: 'condition' | 'and-or' | 'negated' | 'called-in-condition'; at: SyntaxNode; sure: boolean }
export interface ErrexitContext {
  errexit: Tri; errexitWhy: 'default' | 'set' | 'off-in-substitution' | 'inherit_errexit' | 'posix';
  ignored?: Ignored; active: Tri; stops: 'script' | 'subshell' | 'unknown';
  checked: true | { why: 'compound' | 'pipeline-stage' | 'job' | 'part-of-command' };
}
export interface StatusModel {
  status(n): StatusRule; errexit(n): ErrexitContext;
  expansionError(n, env?: WordEnv): { word; failure: WordFailure } | undefined; // B4's fatal failures, surely
  turnsErrexitOn(n): boolean;     // a `set` that turns errexit on where it was not (StateModel.setWrites, and errexit before it)
  hidesFailure(pipeline): boolean; // no pipefail, a stage before the last that can fail, a last stage that reads to the end
}
export function statusModel(state: StateModel, shell?: Shell): StatusModel;  // cached per state model
export function conditionOf(n): SyntaxNode[] | undefined; export function lastStatements(n): SyntaxNode[];
// src/statusfacts.ts: statusFacts(root, state, status, shell) → the notes and pitfalls of every line, in ja and en
```

- The design's `ErrexitContext.ignoredBecause` became `ignored`, with the node that causes it and `sure`. `'substitution'` is not a reason but an `errexitWhy`: in bash, a `$( )` starts with errexit off unless inherit_errexit is on (POSIX mode turns it on; other shells keep errexit), and so does a function called only there (`x=$(f)`; "may" when it is also called elsewhere); a `set` inside before the node counts from there. The status model computes this, not the walk of the state: a changed state in `$( )` made the walk run the functions called there again (a 3,000-line script took 7% longer). The walk records the options each `set` command writes (`StateModel.setWrites`), which `turnsErrexitOn` reads with errexit before the command. `#!/bin/bash -e` is not read (the state starts with errexit off: `bash script` ignores the shebang's options). `'modulo-256'` became `given`, and a `wait` and a job have their own rules.
- Ignoring follows the manual's 4.3.1 and the probes: the condition of `if`, `elif`, `while`, `until`; every command of an and-or list but the last; `!`; and it reaches into `( )` and `$( )` there (`if (false; echo in)` prints `in`, also with inherit_errexit). A function body is ignored when every call (B2's `calls`) is: `sure: false` when some are, and the body then says "may". A call of the function from itself does not count. A `set -e` that is itself in the ignored place (`set -e && cmd`, `if set -e; then`) takes effect at once; only one inside a group or a function there waits for it to end.
- `checked`: simple commands, assignments, `[ ]`, `[[ ]]`, `(( ))`, pipelines and `( )`. Lists and the other compound commands are not, so `{ false && true; }` does not stop the script but `( false && true )` and `f() { false && true; }; f` do. A pipeline's stages and a job are not either, nor an assignment that is part of a command. `stops` reads B2's `processOf`, but for a `( )` the shell that checks it is the one around it.
- `expansionError` uses B4's `wordFields`: without the environment (the analyzer gives none) a variable may come from it, so it is surely an error only with the probes' environment. The analyzer does not render it yet.
- test/status-probes.test.ts runs the rows of status.json (93 rows) on a small evaluator: the model gives the rules, the evaluator knows the status of a few commands (`true`, `false`, `[ -f FILE ]`, `cd`…). Every row agrees with bash but 13, each with its reason in `gaps`: trap actions are not read; `bash -c` strings are not run; 126 depends on the file system; an assignment to a readonly variable (B3: it abandons the line, or ends the script in POSIX mode or under `set -e`); a special builtin's error in POSIX mode (B3); `.`; and a body run both where `set -e` is ignored and where it is not ("may").
- src/statusfacts.ts renders the notes and pitfalls in one walk over the script, kept per status model, with the cheap tests first (each statement is visited once; the `$( )` token sentence is rendered per token by the analyzer). It says: on the `$( )` of an assignment with no command, that the script stops if it fails (not when its last command is `… || true`), and on one in a command's arguments that it does not; the `local x=$(cmd)` pitfall (for any `$( )` in a declaration's value; it left src/pitfalls.ts); the first pipeline that hides a failure without pipefail, once per script (where the dialect table says the shell has pipefail); a function whose last command is `test && cmd` (`[ ]`, `[[ ]]`, `(( ))`, `test`, `grep -q` before `&&`), called where `set -e` stops it (or as the script's last command: then the script's status); a `set -e` inside a group or function run where bash ignores it; a function called only where `set -e` is ignored (once, on its definition), and a `( )` or `{ }` there, when a plain command comes before the last; and a `$( )` of several commands, where bash turns `set -e` off. The `((i++))` pitfall (not where `set -e` is surely ignored), the note on `exit 256` and the Dockerfile `pipefail` check read the model too. To keep `set -e` scripts quiet, nothing is said of each command that `set -e` stops on, nor of one-command predicates called from `if`.

Deferred: the ERR trap (it runs where `set -e` would stop the shell; inside it, and inside an EXIT trap, `set -e` is in effect) and trap actions in general; `bash -c` strings (`reachOf(env, shellopts).options` says whether `set -e` reaches them; their text is not read); readonly assignments and special builtins' errors in POSIX mode (B3); the value of conditions (a branch that never runs); rendering `expansionError` where a value is known to be missing; `x=1 $(false)` (no command name after expansion: the substitution's status); `#!/bin/bash -e`.

### 4.12 As built: facts and manual links (B6)

```ts
// src/manual.ts: the sections of the bash 5.2 manual, chapters 3 to 7 and the builtins of 8.7 and 9.2
export const MANUAL_VERSION = '5.2';
export const SECTIONS: ReadonlyMap<string, { id; title; url }>;   // '3.7.2' → Command Search and Execution, its page on gnu.org
export const BUILTIN_SECTIONS: Record<string, string>;            // each builtin's section (its @btindex): cd 4.1, declare 4.2, jobs 7.2
export function manualLabel(lang, ids): string;                  // "Bash manual 3.7.2, 6.11"
// src/refs.ts: the sections of a token, from its node
export function nodeSections(n): readonly string[] | undefined;  // constructs, quotes, expansions, redirections by operator (3.6.1–3.6.10)
export function anonSections(n): readonly string[] | undefined;  // a keyword or operator: its own (`|` 3.2.3, `&&` 3.2.4), else its construct's
export function builtinSections(name, special): readonly string[]; // and 4.4 for a special builtin
// src/messages.ts: the catalog
export const MESSAGES: Record<FactId, { kind: 'note' | 'pitfall'; refs: readonly string[]; text: (params) => [ja, en] }>;
export interface Fact { id: FactId; kind; text: string; refs: readonly string[] }   // text with its ℹ or ⚠
export function fact(lang, id, params): Fact;  export function factOf(lang, { id, params }): Fact;
// src/analyzer.ts
interface Token { …; refs?: readonly string[] }
interface LineExplanation { …; notes: string[]; facts?: Fact[] }   // the notes that are facts, with the same text
```

- `ManualRef` became a section number: the table gives its title and page, so a token or a fact carries only `'3.7.2'`. The design's `Fact` with a node and a `meaning` severity was not needed: a meaning is a sentence of the token's explanation, and the token's `refs` cite it; a fact is a note (`kind`), said where the model is read: the analyzer, src/statusfacts.ts (which now gives `{ id, params }` per line, rendered in either language) and src/wordfacts.ts.
- **The URL (decision 7).** gnu.org serves only the manual of the current release, one page per node (`html_node/Command-Search-and-Execution.html`); no versioned copy of the 5.2 manual is known there (the 5.2 manual ships in the source tarball and the git tag, as Texinfo and one-page HTML). This could not be checked online when B6 was built (no network); if gnu.org publishes a versioned copy, only `BASE` in src/manual.ts changes. The links point to gnu.org, and the numbers are those of 5.2. bashref.texi of 5.2 and of 5.3 have the same nodes and titles for every section of the table; only "Bash POSIX Mode" moved, from 6.11 to 6.11.2 (its page name is unchanged). The redirections share one page; their subsections are anchors (`Redirections.html#Here-Documents`). test/manual.test.ts rebuilds the table from bashref.texi at the tag `bash-5.2` when `BASH_SOURCE_DIR` names a bash git checkout (numbers, titles, page and anchor names as makeinfo writes them, and every builtin's section), and the anchors were checked against the 5.2 bashref.html.
- **Tokens.** A construct, keyword or operator cites its section (if 3.2.5.2, loops 3.2.5.1, `{ }` and `( )` 3.2.5.3, functions 3.3, coproc 3.2.6, pipelines and `time` 3.2.3, lists 3.2.4, `[ ]` 4.1 and 6.4, `[[ ]]` 3.2.5.2 and 6.4, `(( ))` 3.2.5.2 and 6.5); a quote its subsection of 3.1.2; an expansion its subsection of 3.5 (`$1` 3.4.1, `$?` 3.4.2); a redirection its subsection of 3.6, from its operator and target (`2>&1` 3.6.8, `3>&1-` 3.6.9, `>&file` 3.6.4); an assignment 3.4, before a command 3.7.4 (and 4.4 when it stays); arrays 6.7; the shebang 3.8. A command name cites what the name resolution found: a builtin's section (and 4.4), a function 3.3, an alias 6.6, a path or a program found otherwise (`hash -p`, `enable -n`) 3.7.2, a name from an expansion 3.7.1. A program of the dictionary, its options and plain words cite nothing: they are not parts of bash.
- **Facts.** 53 ids (exit status, errexit, functions and POSIX mode, aliases, pipelines and globs, wrappers and other shells, words). The texts are the analyzer's, unchanged. Not facts: the style checks of src/pitfalls.ts (`[-f`, `x = 1`, `{echo`, `}` without `;`, `rm -rf $DIR/…`, `read` without `-r`, `<` in `[ ]`, `[ -f x]`, `[ a && b ]`), the dialect notes, the dictionary's notes (distribution aliases, yq), the redirection summary, the here-document and continuation notes, the syntax errors.
- **Renderers.** The hover ends a row and a note with `<small>Bash manual [3.7.2](url)</small>` (VS Code keeps `<small>`); the plain Markdown (the LSP hover, Copy as Markdown, `--format markdown`) with `(Bash manual [3.7.2](url))`; the panel, in VS Code and on the web page, with quiet `§3.7.2` links at the end of the row (`panelUpdate` sends the label, title and page of each section shown), which open in the browser (VS Code opens a webview's links outside, after its usual prompt for an untrusted domain; the web page in a new tab); the CLI text with "(Bash manual 3.7.2)", dim in colour; JSON gives `refs` and `facts` as they are. The links are plain links: nothing is fetched (test/offline.test.ts and the web page's CSP).
- Tests: test/manual.test.ts (every cited section is known, the sections of tokens, the table against bashref.texi), test/messages.test.ts (every entry's sections, the prefixes, `facts` in the explanation), test/wordfacts.test.ts, and the render, CLI, LSP and web tests. The dumps of sample.sh and the corpora are the same as before but for the sections.

Deferred: the notes of `read` (`IFS=` and separators) and of `[[ =~ ]]` backslashes are still inline (about a builtin and a regex, not a model); a fact for each meaning sentence of a token (the token's `refs` cite them as a whole); links in the inline display (one line, no room); section numbers for the notes of the dialect check (about other shells, not in the manual).

## 5. C: the bash-ast differential test

### 5.1 What it compares

[bash-ast](https://github.com/cv/bash-ast) runs bash's own parser and prints its tree as JSON: lists, pipelines, compound commands, simple commands with `words`, `assignments` and `redirects` (`direction`, `source_fd`, `target`), and the line of each simple command. It gives no columns.

The test (test/bash-ast.test.ts, with test/support/bashast.ts) parses every input of the corpus (`corpus()` in test/support/corpus.ts: the fixtures, the extracted host files, test/fixtures/snippets.json) with both, turns both into one **shape**, and compares the shapes:

```ts
type Shape =
  | { k: 'seq'; items: { cmd: Shape; background: boolean }[] }        // `;`, newline, `&`
  | { k: 'and-or'; first: Shape; rest: { op: '&&' | '||'; cmd: Shape }[] }
  | { k: 'pipeline'; negated: boolean; stages: Shape[]; stderr: boolean[] } // `|&` per stage
  | { k: 'simple'; line: number; assignments: string[]; words: string[]; redirects: Redir[] }
  | { k: 'subshell' | 'group'; body: Shape; redirects: Redir[] }
  | { k: 'if'; branches: { cond: Shape; body: Shape }[]; else?: Shape }
  | { k: 'for' | 'select'; variable: string; words: string[] | 'implicit'; body: Shape }
  | { k: 'arith-for'; init: string; test: string; step: string; body: Shape }
  | { k: 'while' | 'until'; test: Shape; body: Shape }
  | { k: 'case'; word: string; items: { patterns: string[]; body?: Shape; end: ';;' | ';&' | ';;&' }[] }
  | { k: 'function'; name: string; body: Shape }
  | { k: 'arith'; expression: string }
  | { k: 'cond'; expr: CondShape }
  | { k: 'coproc'; name: string; body: Shape };
interface Redir { fd: number | null; op: string; target: string }
```

It checks:

- **Command boundaries**: the same simple commands, in the same order, starting on the same line.
- **The list and pipeline shape**: `;`, `&`, `&&`, `||`, `|`, `|&` and `!`, with bash's precedence.
- **The words of each simple command**: the assignments, then the words, as source text.
- **Redirections**: the operator, the fd (default or explicit) and the target text; here-doc bodies and delimiters.
- **Errors**: both trees have an error, or neither has.

### 5.2 Kind mapping

| bash-ast | our model |
|---|---|
| `list` `semi`, `amp` (left-nested) | statements of `program`, a body or a `do_group`; `&` token after a statement. An empty `simple` on the right of a trailing `amp` is dropped. |
| `list` `and`, `or` | `list` with `&&`, `\|\|` |
| `pipeline` (`negated`) | `pipeline`; `negated_command` over it; `\|&` is a stage's `dup_output` of fd 2 in bash-ast |
| `simple` | `command`, `declaration_command`, `unset_command`, `test_command` (`[` and `]` are words), `variable_assignment(s)`; a `redirected_statement` around them |
| `subshell`, `group` | `subshell`, `compound_statement` (`redirects` from the `redirected_statement`) |
| `if` with `else_branch` that is an `if` | `if_statement` with `elif_clause`, `else_clause` |
| `for`, `select` | `for_statement`, `select_statement`; `for i; do` gives bash-ast's `"$@"`, shown as `implicit` |
| `arithmetic_for` | `c_style_for_statement` |
| `while`, `until` | `while_statement` (told apart by its first token) |
| `case` (`fallthrough`, `testnext`) | `case_statement`, `case_item` with `;&`, `;;&` |
| `function_def` | `function_definition` |
| `arithmetic` | `arithmetic_command` |
| `conditional` (`cond_type`: and, or, not, unary, binary, term) | `extended_test` and its expressions |
| `coproc` | `coproc_statement` (`COPROC` when no name) |
| redirect `direction` | `output` `>`, `append` `>>`, `input` `<`, `input_output` `<>`, `clobber` `>\|`, `err_and_out` `&>`, `append_err_and_out` `&>>`, `dup_output` `>&N`, `dup_input` `<&N`, `close` `>&-`/`<&-`, `here_doc` `<<`/`<<-`, `here_string` `<<<` |

bash-ast does not keep everything, so these are not compared: `time` (dropped), the variable of `{fd}>` (no fd given), comments, and word flags beyond "quoted". The lines of compound commands are compared only where bash-ast gives them.

Inputs left out: other dialects (ksh.ksh, and snippets that src/dialect.ts reads as zsh or ksh), and inputs with an extglob pattern. bash-ast parses the whole input at once with extglob off, so `shopt -s extglob` never takes effect and `!(…)` is a syntax error.

### 5.3 Reporting

- A difference is reported with the input's name, the path in the shape (`seq[3].and-or.rest[0].pipeline.stages[1].words[2]`), the line, and both values:
  ```
  snippet 412: "echo a | b && c"
    seq[0].and-or.first.pipeline.stages[1].words: ours ["b", "&&"]  bash ["b"]
  ```
- Known differences are listed in test/fixtures/bash-ast-known.json: the input's name, the path, and a reason in our words (for example "unbash accepts `echo (`; README, Limitations"). The test fails on a new difference, and on a known one that is gone, so the list stays true (like coverage-floors.json).
- At the end, the test prints the counts: inputs compared, skipped (by reason), equal, known, new.

### 5.4 CI

The test looks for the binary in `$BASH_EXPLAINER_BASH_AST`, then on `PATH`; without it, the suite is skipped (`this.skip()`), as the tests of real tools are. It runs one process per input (about 1,000 inputs, a few seconds). It lives in test/, so the coverage of `src/` does not change. Whether CI builds bash-ast is an open question (7).

### 5.5 The GPL boundary

bash-ast is GPL-3.0, and so is the bash it embeds. This project is MIT. The rules:

1. bash-ast is used **only as an external program**, started with `child_process` by a test. Its JSON on stdout is the only thing exchanged.
2. It is **never** added to package.json (no dependency of any kind), vendored, put in a submodule, linked, loaded as a library or wasm, or put in a bundle. test/offline.test.ts and test/licenses.test.ts keep checking the bundles.
3. **No code** of bash-ast or bash is read for the implementation or copied. The mapping above is written from its observed output and its `--schema`.
4. Its output is **not committed**. The known-differences file holds only names, paths and our own reasons.
5. The test is **optional**: skipped without the binary, so the project builds and tests without any GPL software.
6. The same holds for other GPL sources named here (bash-completion, the man pages, the GFDL manual): ideas and section numbers, no text or code.

## 6. Migration

Strangler steps. Each one is a PR (or a stack) that ships with every existing test passing and 100% coverage. Sizes are rough, in lines of code with tests.

**C1. The bash-ast test.** test/support/bashast.ts (runner and shape of bash-ast's JSON), the shape of our tree, the test, and the known-differences file. Fix the adapter bugs it finds, each with a CHANGELOG line. Guarded by: itself, and the adapter tests. Size: 400–600, plus fixes.

**A1. The spec types and the interpreter, in the shadow.** Done (#135). src/argv/spec.ts, src/argv/interpret.ts and the operand matcher. A converter `fromCommandDoc(doc)` turns today's `CommandDoc` into a `CommandSpec`. A test runs both the old walk and `interpret` on every command of the corpus and of the analyzer tests, and compares the roles (the same oracle method as the move to unbash). Nothing changes for users. Size: 900–1,200.

**A2. The walk reads the interpreter.** Done: the shadow test found 31 words the old walk read wrongly; test/argv-fixes.test.ts keeps them, and the comparison is gone. The ssh and `su -c` pitfalls read the command slot. `args`, `option`, `bundle` and `describeByCount` become a renderer of `ArgvParse`. `glueOption`, `fillsPositional`, `optionGiven` and `killSignal` go. The converter still feeds it. Guarded by: analyzer, options-fixes, positional-count, oldstyle, wrappers, builtins-flags and dictionary tests. Size: −600 / +400.

**A3. Families move to native specs**, one PR each, removing the name branches as they go:
- wrappers and shells (sudo, env, timeout, nice, nohup, xargs, chroot, flock, ssh, su, bash/sh, exec, command, builtin, eval): `CommandSlot`; `WRAPPER_PROGRAMS`, `SHELL_ONLY`, `remoteNotes` and `shellArgument` go. Done: also doas, time, setsid, stdbuf, ionice, watch, strace, ltrace, unshare, nsenter, runcon, systemd-run, systemd-cat, caffeinate, npx, `perf stat|record`, `docker run|exec`, `docker compose run|exec`, `podman`, `kubectl exec|run|debug`, `uv run` and `poetry run`. The pitfalls follow from the slot's `run` and `where`; `find -exec` keeps its converted `until` slot. The fields `wraps`, `wrapSkip`, `afterDashes`, `assigns` and `shellC` are gone. Still to move, with the families that use them:
  - the rest, until A4: `arg`, `argCount` and `restOperands` (jq, with `longEquals`), `values`, `lang`, `fillsPositional` (grep, sed, perl), `nextIf` (journalctl), `attachedOnly`, `untilTerminator` and `longSingleDash` (find, with its option filter and `operandParser`), `positional`, `positionalBy`, `positionalLang`, the count patterns of `head` and `tail`, and awk's `assignmentText`;
- builtins (set, shopt, declare/export/local/readonly, unset, kill, trap, read, mapfile, getopts, wait, jobs, echo, let, `.`). Done: every entry of src/dict/builtins.ts is a native spec. `SPECIAL_BUILTINS` (in the converter and the analyzer), `PROGRAMS`, `JOB_COMMANDS`, kill's rules, echo's and let's styles, the `let` and `shopt` operand types, set's `next-only` and `plusOptions` by name are gone, and so are the fields `positionalWith` and `builtin`. test/builtins-real.test.ts compares the roles with bash. Left for B (the analyzer's own explanations, not the reading of the words): the text of `set -o` with no name, the note on trap's action, the texts of the declaration commands' flags, from the tables of src/dict/syntax.ts (their words are read with the builtin's spec: options end at the first name or `--`), and the examples of `read`, `printf` and `test`. Not described yet: the `set -o` names that `shopt -o` takes, the stack positions `+N` and `-N` of `dirs`, `pushd` and `popd`, and the command `jobs -x` runs;
- modes and old styles (rpm, dpkg, tar, ps, ar). Done: also dpkg-query, dpkg-deb, jar, dump and restore. rpm's query mode, the old-style letters and dpkg's `shortEquals` are in their entries; the fields `bundle` and `inMode` (and `BundleDoc`) are gone, and so are the converter's rules for modes, old styles and dpkg. ps reads its BSD letters in any word (`oldStyle.anywhere`). test/oldstyle-real.test.ts compares with tar (`tar --help`, and the archive and members it acts on), ps, ar (`ar --help`) and dpkg-query. Not compared: rpm, jar, dump and restore (not installed where the tests run). Not described yet: procps reads digits after BSD letters as PIDs (`ps u1`), and GNU tar reads any first word without a dash as letters (`tar vf a.tar` is an error there, not a file);
- subcommand trees (git, kubectl, docker, systemctl, ip), with `persistent` options instead of spreads. Done: an option of a converted entry is persistent with the flag `persistent` (`persistent(list)` in src/dict/types.ts), so the trees stay in the shape of `cmd` and the converter builds them. kubectl, `docker compose` (and `podman compose`), systemctl, apk, aws, gcloud and terraform write their shared options once, on the parent; the `...kube` and `composeOpts` spreads and the inheritance loop of extras.ts are gone. kubectl's `-f` and `-k` stay options of the subcommands that take manifests (`kubeFiles`), so `logs -f` follows. ip's options are not inherited: iproute2 reads them only before the object (`ip addr show -s` takes `-s` as a device). `git log` and `git show` are native, with their count (`-3`) as a pattern option (`countOption`); `COUNT_COMMANDS` keeps only `head` and `tail`, and the converter no longer passes a subcommand's name. test/subcommands-real.test.ts compares with git (`GIT_TRACE`: the subcommand and its words after the global options; `git log -N`), ip (its options before and after the object) and systemctl (every option after the verb). Not compared: kubectl, docker and podman (not installed where the tests run); `kubectl config` now has kubectl's options, as the kubernetes.io reference lists for `kubectl config view`. Left for A4: the subcommand trees are still `CommandDoc.subcommands`, converted; option lists shared by some subcommands only (apt, apt-get, dnf, yum, microdnf, zypper, helm, gh, kind, cosign, defaults, pip, pnpm, yarn, `git stash`) are the options of those subcommands and stay so. Not described yet: cobra programs (kubectl, docker, helm, gh) read a subcommand's own options before its name too (`kubectl -o yaml get pods`); kubectl's parent options are wider than its real global options (`kubectl logs -o` is accepted here).
Guarded by the same tests, plus a table per family in the tests that compare with real tools where one exists (`timeout`, `seq`, `cp -t`, `chmod --reference`, `date -I`, bash builtins). Size: 300–800 each.

**A4. Remove the old fields.** `cmd()` builds a `CommandSpec`; `CommandDoc`, `OptDoc`, `BundleDoc`, `PositionalBy` and the converter go. The dictionary test checks every spec: unique names, a `ValueSpec` for every option with a value, patterns that can match. The customCommands setting reads the new shape (and the old one, converted, for a release). Done: `cmd()` returns a `CommandSpec`, and so does every entry, subcommand and yq flavour; `native()`, src/argv/fromdoc.ts, `CommandDoc`, `OptDoc` and `PositionalBy` are gone (`BundleDoc` went in A3), and the analyzer reads only specs (`lookupCommand` returns one). Nothing of `CommandDoc` was display-only: the summary of an entry and of a subcommand is the spec's `summary`. The effective spec of every entry and subcommand is the same as the converter's, except for the source text of head's count pattern (now `countOption`). test/dictionary.test.ts checks every spec, with its subcommands and find's expression: each option name once at each level; a well-formed `ValueSpec` for every option with a value (a name; `next` and `attached-only` only with `optional`), and an `until` with terminators and no value; and, for every operand alternative, words that the interpreter reads with that alternative (its options, then its items once, or twice where they repeat). (An option the condition names need not be in the entry: `sh -s` is read with the alternative for `-s`, though `sh`'s entry does not describe `-s`.) customCommands takes the new shape, and converts the old one (3.7). Left as they are: `positional` and the tuples, as shorthands of `cmd`; the option lists shared by some subcommands only (A3).

**Probes.** The B steps compare the model with what bash does. test/support/probe.ts runs bash 5.2 (`bash --norc --noprofile`, `LC_ALL=C`, a fixed `PATH` and `HOME`, a fresh directory with known files) on a snippet whose markers (`@PROBE:id@`) become a call to an instrumentation function; the probes skip when bash is missing or older than 5.2. The tables are test/fixtures/probes/*.json: each row is a manual section, a snippet and the facts bash gave, recorded by scripts/record-probes.ts and checked by test/probe.test.ts. Each step reads its own table: B1 `state.json` (`shopt -p`, `set -o`, `declare -p`, `declare -F` and `alias` at a marker and at the end, as changes from an empty script), B2 `env.json` (main shell, subshell or another shell, from `$BASHPID` and `$$`), B3 `names.json` (`type -t` under bash and `bash --posix`), B4 `words.json` (the fields of the words after a marker) and B5 `status.json` (under `bash -e`: the markers that ran, and the exit status). A step adds the rows it needs, records them, reads the facts, then makes its test compare the model with every row.

**B1. Shell state.** src/semantics/state.ts builds `ShellState` along the tree, with parse-time and run-time states; `shoptStates`, the scans in `explainLine` (functions, arrays, IFS, noglob, aliases) move there. Cached per tree. Guarded by: analyzer, audit-shell, mode and pitfalls tests; a new probe test runs bash on snippets with `shopt -p`, `set -o` and `declare -p` at the end and compares. Size: 600–900. Done: the model is in src/semantics/state.ts (4.7); `shoptStates`, the scans of `explainLine` (functions, arrays, associative arrays, integers, namerefs, IFS, noglob, aliases), `exportedFunctions`, the `set -o posix` regular expression, `pastedValue`'s scan, the CI variables' regular expression, the `unset -f` regular expression and the `lastpipe` tests are gone, and the analyzer asks `shellState(tree, shell).at(node)`; src/hosts.ts reads `set -o pipefail` in a Dockerfile RUN with it. test/state-probes.test.ts compares the model with every row of state.json (50 rows; what the model gives as unknown or does not follow is listed in each row's `gaps`, with the reason), and test/state.test.ts tests the walk, with a bound on its time.

**B2. Execution environments.** `ExecEnv` for every node; the four subshell checks go. A command run by a wrapper has the chain of slots that leads to it (`env -i` → `bash -c`), and its environment is what each link passes on (3.7); `slotChain` and `functionBlocker` in the analyzer go. A probe test compares with bash: a marker command replaced by `[ "$BASHPID" = "$$" ]` says whether it runs in a subshell. Size: 300–500. Done: src/semantics/env.ts (4.8); `shellState(tree).env(n)` gives the chain of every node, from the walk's calls and states and the subshell rules it shares with the walk. test/env-probes.test.ts compares it with the 37 rows of env.json (added: `env -i`, `xargs` and `find -exec` with `bash -c`, `exec` in a subshell, `{ }` in a pipeline, `done < <(…)`, coproc of a command and of `( )`, trap actions, `eval` in a pipeline and a subshell, `command`, `builtin eval`, `time`, functions called from several subshells), and test/env.test.ts the chains that cannot be probed (sudo, ssh, containers).

**B3. Name resolution and assignments.** `NameResolution`, `AssignmentMeaning`, special builtins and POSIX mode; `commandHeadFor` renders from it. The name-keyed cases left in src/analyzer.ts go here or in B1: the flag texts of the declaration commands (their words are read with the builtin's spec, but the texts come from the tables of src/dict/syntax.ts chosen by the name), `unset` (its own node, with regular expressions for `-f` and `-n`), `head.name === 'test'` (the expression reading), the positions of `read -a NAME` and of mapfile's array in the scans of `explainLine` (by name and word position, not by the interpreter), the `set -o posix` regular expression of the special-builtin assignment note, the `set` scan for noglob, and `exportedFunctions`, a regular expression over the whole source that ignores where the export is (before or after the use, in a function or not). Probe: `type -t` at the place of the command, under bash and `bash --posix`. Size: 500–700. Done: src/semantics/names.ts (4.10); the cases listed above are gone from the analyzer, and `exportedFunctions` and the `set` scan for noglob had gone in B1. test/names-probes.test.ts compares the model with the 28 rows of names.json (added: functions defined after use, in a pipeline stage, in an `if`; `enable -n` and `enable`; a special builtin and a function in POSIX mode; aliases with expand_aliases on and off, in POSIX mode, in chains, on the line that defines them; `hash -p` forgotten by PATH, `hash -r` and `hash -d`; PATH changes; exported functions in `bash -c`, `dash -c` and `env -i bash -c`; the dash row has `requires: "dash"`, and is not run again where dash is missing) and the prefix assignments with two rows of state.json (a function, `export`, `eval`, `command` and `builtin`, in both modes). Left for later: the examples are still chosen by the command's name (`read`, and `commandExampleFor`), but only for a builtin or a program, not for a function of the script.

**B4. Words.** The context table and `WordMeaning`; `splitNote`, `noSplit`, `valueNote`, `globOff`, `afterAssignment`, `tilde` and the quoting notes render from it. Probe: bash prints the fields of a word in its context (`printf '<%s>'` in a temporary directory with known files and `IFS`), compared with `fields` and with the static value. Size: 800–1,200. Done: the table and `WordMeaning` are in src/semantics/words.ts (4.9); the analyzer's `splitNote`, `globOff`, `tilde` and the note on `$_` render from it, and `noSplit`, `ifsAt` and `afterAssignment` are gone. test/word-probes.test.ts compares `wordFields` with every row of words.json (62 rows; a marker the model gives as unknown is in the row's `gaps`, with the reason; a redirection is checked by the file the run created), and test/words.test.ts compares a here-string and a here-document with bash. `valueNote` and the text of double-quoted strings still read src/staticword.ts, which the model uses for `value` too.

**B5. Status and errexit.** `StatusRule`, `ErrexitContext`, and their facts. Probe: bash runs the snippet with `set -e` and a marker after it. Size: 300–500. Done: src/semantics/status.ts and src/statusfacts.ts (4.11). test/status-probes.test.ts compares the model with every row of status.json (93 rows, 50 added: functions called from `if`, `&&`, `!` and from both kinds of places, `set -e` in a subshell and a substitution, inherit_errexit, POSIX mode, `!`, lists, pipefail set in a function, `time`, `wait`, the ERR trap, assignments and declarations with substitutions, readonly assignments, `[[ ]]`, `(( ))`, `return`, `bash -c` with and without SHELLOPTS, `set -u`, `set -e && …`, `if set -e`, `{ set -e; … } || :`, `for` over no words), with the gaps listed in the rows. The analyzer had no errexit logic of its own besides the `local x=$(…)` pitfall in src/pitfalls.ts, the unconditional `set -e` sentence of the `((i++))` pitfall, the modulo of `exit N` and the Dockerfile `pipefail` test: they read the model now.

**B6. Facts and manual links.** The message catalog, `refs` on tokens, links in the hover, the panel and the web page; section numbers in the CLI. src/pitfalls.ts keeps the style checks. Guarded by the render and web tests. Size: 400–600. Done: src/manual.ts, src/refs.ts, src/messages.ts and src/wordfacts.ts (4.12); every renderer shows the sections, and the dumps change only by them.

**The redesign is complete.** The layers, as built:

```
SyntaxTree (src/syntax/, unbash) ── checked against bash's parser (C, test/bash-ast.test.ts)
  ├─ argv: CommandSpec → interpret() → ArgvParse (A, src/argv/; command slots)
  └─ semantics (B, src/semantics/): shellState → state.ts (B1), env.ts (B2) → names.ts (B3), words.ts (B4) → status.ts (B5)
       └─ each compared with bash 5.2 by its probes (test/fixtures/probes/*.json)
Analyzer (src/analyzer.ts): lays out tokens, labels and examples; renders the specs and the models;
  facts from src/messages.ts (statusfacts.ts, wordfacts.ts), sections from src/refs.ts and src/manual.ts (B6)
Renderers (src/ui/, media/panel.js, cli/, web/): hover, panel, inline, CLI text/Markdown/JSON, LSP, web page
```

The analyzer no longer decides what a construct means from node types or names: it asks the specs and the models, and says what they found. It did not shrink to half, as hoped (4,460 lines after B6): most of it is the layout of tokens, the examples and the texts of the explanations, which stay there.

Spec fields that serve one or two entries, candidates to generalize when a third needs them: `marks`/`unlessMarked` (kill's first signal), `OperandSpec.option` (`flock FILE -c`), `longEquals` (jq) and `shortEquals` (dpkg).

## 7. Risks and decisions

Risks:

- **A larger first step.** A1 and A2 touch the code that most tests depend on. The shadow comparison of A1 lowers the risk: A2 starts only when the interpreter agrees with the old walk, or each difference is a known fix.
- **Merged state may say "unknown" too often.** A note should then say what depends on run time, not stay silent. The probes of B1 show where precision matters.
- **Backtracking operand patterns** can be slow on long argument lists. Patterns are short, and `*`/`+` items are few; the matcher caps the work and falls back to `unmatched`.
- **customCommands** in users' settings use today's shape. A4 keeps a converter for one release (0.7): src/dict/custom.ts reads both shapes.

Decisions (2026-10-21, by the maintainer):

1. **bash-ast in CI:** no. The differential test is local; it is skipped when the binary is missing (CI has none).
2. **Inputs with extglob:** skipped from the comparison.
3. **Unique-prefix long options:** a per-spec switch, off by default; on for GNU tools that use getopt_long.
4. **withfig/autocomplete (MIT):** the structure of options (names and arity) may be imported, with a notice in THIRD_PARTY_NOTICES.md. The texts stay our own.
5. **State unknown after a branch:** the explanation says it depends ("may"), not nothing.
6. **Function bodies:** walked from the state at the definition, merged with `unknown`. Call-site merging can come later. Revised after the review of B1: a body's state comes from its call sites. It is walked at each call with the caller's state, remembered by entry state, with a guard against recursion; a function never called (or only called from places no call reaches) is walked from its definition's state merged with `unknown` for everything the script changes after the definition.
7. **Manual links:** a fixed version (bash 5.2). Japanese explanations link to the English manual.
8. **Section numbers:** a link where the renderer supports links (panel, hover); the CLI writes "(Bash manual 3.7.3)" in the text.
9. **PARTIAL and MISSING items:** wait for the step that covers them. Only errors (explanations that contradict bash) are fixed in the old code meanwhile.
