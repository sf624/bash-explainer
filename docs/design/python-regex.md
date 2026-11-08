# Python regular expressions

The plan for explaining the patterns of Python's `re` module in `.py` files: `re.search(r'^\d+$', s)` gets the tokens of its pattern, as a `grep -P` pattern does in a shell line. It is the first part of a host file that is not shell code, so most of this page is about how such a part enters the products without a second source of any fact.

Status: Tracked in #748, #749, #750, #751, #752, #753.

The maintainer decided on 2026-11-08:

- The patterns are shown in the panel and the hover, and their errors and pitfalls in Problems, in VS Code and on the web page, like shell lines.
- The third-party `regex` module is out of scope.
- One Python version: the current stable release. Where a construct's meaning or validity depends on the release, a note says so. There is no `pythonVersion` setting.
- The issues go in Next, after the Bazel items (#732 to #744). This page is reviewed before the first step, since the first non-shell part touches every product.

The research behind it (Python 3.12.3, the installed standard library and dist-packages: 1,862 `re.*(` calls, 66% with a literal first argument, 909 of them raw strings) is summarised where it is used.

## 1. What a user sees

- In a `.py` file, the hover on any part of a pattern literal explains that part: `\d+`, a group, a class, an anchor.
- With the cursor on the line, the panel shows one top row, "Python regex (argument of `re.search`)", with the pattern's rows under it, at their places in the file.
- A pattern over several lines (a triple-quoted `re.VERBOSE` pattern) is explained whole on each of its lines, as a shell statement over several lines is.
- A pattern Python rejects is an Error in Problems, with Python's own message (`bad escape \e at position 0`). Pitfalls are Warnings: `"\bword\b"` without `r` (two backspaces, nothing matches), `re.sub(p, r, s, re.I)` (the flag is taken as `count`).
- An example under the pattern: a text it matches and one it does not; for `sub` and `split`, an input and its output.
- The shell chip says there is no shell on such a line: "no shell (Python regex)".
- `bash-explainer file.py` and `--check` give the same, as the Language Server does.

## 2. Parts of a host file that are not shell code

### 2.1 Today

`Extracted` (src/hosts/index.ts) is shell text, line for line: a line outside every `ShellRegion` is empty, and `maps[line]` gives the original column of each shell character. `openDocument` (src/document-setup.ts) parses `Extracted.text` into the document's one tree. Every reader of `regions` takes a region as shell code: `explainHostedLine` and `hostIssues` (src/hosts/remap.ts), `scriptTree` and `regionShell` (src/hosts/scripts.ts), `autoShellAt` (src/document.ts), `hasShell` (src/service.ts, which gates the editor commands, the context key `bashExplainer.hasShell` and the semantic tokens), `blockAt` (src/ui/blockAt.ts), `wrapRuns` (src/ui/wrapRuns.ts, through `maps`).

An embedded language exists only inside a shell word: `fromEmbedded(t, node, lit, origin)` (src/explain/nodes.ts) places a reader's tokens through the word's `SyntaxNode` and its `Literal`. `explainDocumentLine` (src/document.ts) gives a line in no region an empty explanation.

### 2.2 Decision: a second list, `Extracted.languages`

A part in another language is a `LanguageRegion` in a list of its own, `Extracted.languages`. It is never in `regions`, so every reader above keeps its meaning: a region is shell code. Its lines stay empty in `text` and `maps`; it adds nothing to the tree.

```ts
interface LanguageRegion {
  start: number; end: number;            // lines
  label: [ja: string, en: string];       // "Python regex (argument of `re.search`)"
  host: HostId;                          // { kind: 'python' }
  language: 'regex';                     // an EmbeddedLang
  flavor: 'python';
  source: PyLiteralValue;                // the pattern's value, the place of each character, its holes (section 4)
  options: PythonRegexOptions;           // from the flags argument, or "not known" (section 5)
  call: PyCallSite;                      // the function, how the file names it, its arguments as read
}
```

Rejected: a `ShellRegion` with a `language` field. Each of the readers above would need a test to skip it, and a new reader would get it wrong by default. Rejected too: writing the pattern into the shell text as a made-up command (`grep -P '…'`). The tree, bash-ast's test and the reading tree would then claim that bash reads it.

A line holds at most one part. Where a shell region and a pattern share a line (`if re.match(p, x): os.system('ls')`), the shell region keeps the line and the pattern is not explained. That is rare; docs/guide/limitations.md says it.

### 2.3 One lookup per line

`partAt(extracted, line)` (src/hosts/scripts.ts, beside `regionAt`) gives the shell region or the language region of a line, read once per `Extracted` like `regionAt`. `regionAt` stays shell only. `hasShell` becomes "has something to explain": regions or languages. It is one function, and the context key and the semantic tokens read it as they do today. Python keeps its own colours (`OWN_SEMANTIC_KINDS`), so a pattern gets no semantic tokens from us.

### 2.4 The seam in `explainDocumentLine`

`explainDocumentLine` asks `partAt`. A language region goes to `explainLanguageLine` (src/hosts/languages.ts) inside the same `contained` boundary and the same `withinLine(doc.tree.root, …)` call as a shell region. So a bug in it leaves a line that says so, and its examples draw on the line's one budget. The budget's size stays a function of the document's shell text (line-budget.md): a pattern's examples are short samples, each charged to the engine's steps, and every product computes the same size.

### 2.5 A line's explanation without a shell tree

A language line has no `Explainer`: there is no tree node, shell state or command around it, and building a context over an empty tree would let every module of src/explain/ believe there is one. `explainLanguageLine` builds the `LineExplanation` from the same pieces the shell path uses:

- **Tokens.** The embedded reader (`explainRegex`, flavor `python`) reads `source.value`. Its tokens are placed by `placeEmbedded(t, at, label, origin)`, the half of `fromEmbedded` that takes a position function: `fromEmbedded` becomes `placeEmbedded` with `sourcePos` over `sourceIndex`, and a language line passes the literal's offset map (section 4). One function places embedded tokens. The top token spans the literal(s), with `origin: 'embedded'`, `language: 'regex'`, and its text from the catalog of token texts (src/messages-tokens.ts).
- **Errors.** A token Python rejects carries a `tokenError` mark from the catalog (src/messages-levels.ts), as shell tokens do. `tokenErrorNotes` (src/explain/line-notes.ts) is split: its walk takes a sink (`sayAt`), the `Explainer`'s or the language line's. That sink is the `anchored` helper with an anchor list and a data map, the same functions `LineExplainer.say` and `sayAt` use.
- **Facts.** The pitfalls of the call and of the string (section 5, issue 3) are catalog facts. They go through `said` (the `notes.pitfalls` gate) and `basisGate` (the `notes.basis` gate), and `markTokens` puts them on their tokens, as `explainHostedLine` does for bats.
- **Context.** One entry, the region's label at its first line, as a host region has.
- **Reading tree.** One root in the layer `language` (kind `language`, labelled "regex (Python)" with `flavorName`, reader the function, `re.search`), with the nodes src/reading.ts makes of embedded tokens today. There is no bash layer. src/reading.ts exports the function that makes a language's nodes from its tokens; `readingTree` and the language line both call it.
- **Not made:** no sentence ("In short"), no `argv`, no `notPosix`: they are about bash's reading.
- **Several lines.** The explanation is made once per region and kept (a `WeakMap` on the region). Each line of the region returns the same tokens and anchors, so `noteIssues` reports each anchor once, as it does for a shell statement over several lines (`Whole`).

### 2.6 Problems

`noteIssues` already walks every line through `explainDocumentLine`, and turns the noted anchors into problems. A language line with notes and anchors needs nothing more there. `issuesOf` keeps calling `hostIssues` for shell regions only: a language region has no dialect issues. Suppression comments (`# bash-explainer disable=…`) work as they do on any line.

The pattern errors of the shell flavors (`grep -P '\Q'`, an unclosed `[`) are error tokens with inline texts and no mark today, so they are not problems. The Python flavor's errors are catalog entries with marks from the start. Whether the shell flavors follow is open (section 11).

### 2.7 The chip

`autoShellAt` at a language line gives a new reading, `language`, which src/messages-shell.ts words "no shell" with the region's label ("no shell (Python regex)"). A line in no part keeps today's rule over the shell regions. A file with no shell region at all says `language` everywhere: nothing in it is read as shell. A shell chosen in the chip changes nothing on a language line.

### 2.8 The setting

The value `python` of `bashExplainer.embedded.files` turns the whole Python host on and off, regexes included: one switch per kind of file. Its description ("Python's subprocess and os.system") gains "and re patterns", in both languages. The Python extractor no longer returns early when no `subprocess` or `os` call is imported: it returns early when neither those nor `re` are.

### 2.9 New facts and their sources

Issue 1 adds these rows to the table of docs/design/sources.md, section 3, each with its guard:

| Fact | Source | Guard |
| --- | --- | --- |
| The parts of a host file that are not shell code | `Extracted.languages`, read through `partAt` | A test that no reader of `Extracted.regions` outside src/hosts/ reads `languages`, and that `partAt` is the only reader of both |
| The value of a Python string literal and the place of each character | `pyValue` (section 4) | A test that src/hosts/ has one escape table for Python strings (today `pyUnescape` and `pyScript` have one each) |
| What a Python file imports under which name | The import table of src/hosts/python.ts | The regex guard's allow-list (test/examples-regexguard.test.ts) loses the entries for src/hosts/python.ts: no RegExp is built from a name of the script |
| Where an embedded token is in the document | `placeEmbedded` | `fromEmbedded` calls it; no other function builds an embedded token's span |

## 3. The `python` flavor

`Flavor` (src/embedded/regex.ts) gains `python`, with the tool `python` and the unit `text`. It shares the PCRE paths. Where Python differs, the tables are keyed by flavor (each escape's meaning, whether it is valid, what JavaScript reads for it); no `if (flavor === 'python')` is spread through the reader. Its texts are catalog entries of the token texts, so the regex reader's catalog grows with this flavor; the existing inline `s(ja, en)` texts of the other flavors stay until sources.md row 14 moves them.

`RegexOptions` gains `python: PythonRegexOptions`: `ascii`, `ignorecase`, `multiline`, `dotall`, `verbose`, `locale`, `bytes`, each `true`, `false` or "not known" (a flags argument that is not a literal).

What Python reads differently from the PCRE reader today, each verified with Python 3.12:

- **Rejected by Python** (`re.error`), accepted by the PCRE reader: `\e`, `\h`, `\G`, `\K`, `\Q`, `\p{L}`, `\k<n>`, `\x{41}`, `\z` (before 3.14, to be checked against the 3.14 documentation), and any other unknown ASCII-letter escape, in a class too (`[\e]`); `(?<name>…)` without `P`; `(?|…)`, `(?R)`, `(*VERB)`; a lookbehind of variable width, alternatives of unequal length included (`(?<=a|bc)`: "look-behind requires fixed-width pattern"); global flags not at the start (`a(?i)b`); `(?L)` on a str pattern; a group name defined twice; `\10` with fewer than ten groups ("invalid group reference 10").
- **Read differently:** `\Z` is the end of the string only (the reader's table says "or before a final newline", wrong for Python); `$` without `MULTILINE` also matches before a final newline; `\d`, `\w`, `\s`, `\b` are Unicode for a str pattern, ASCII for bytes or with `re.ASCII`; `\s` of a str includes `\x1c`–`\x1f` and `\x85`; a backreference to a group that did not take part fails (`(a)?b\1` does not match `b`); `[[:alpha:]]` is no POSIX class but a set, with a FutureWarning ("Possible nested set"), a Warning token; `{,2}` repeats 0 to 2 times.
- **Read only by Python here:** `\N{EM DASH}`, `\u`, `\U` (str patterns only), octal `\101`; `(?P<name>…)`, `(?P=name)`; conditionals `(?(1)a|b)` and `(?(name)…)`; atomic groups `(?>…)` and possessive quantifiers `a++`, `a?+`, `{1,3}+` (3.11+); `(?#…)`.

`(?P=name)` and conditionals are valid PCRE too, unread today ("a PCRE construct this explainer does not read"). The shared path reads them for both flavors, so `grep -P` gains them; the PR lists that change of explanations.

A `\N{…}` name is not checked against Unicode's names (no table is shipped): the text says "the character named EM DASH", and the example is refused.

## 4. The pattern literal

### 4.1 What is found

A call is found from the file's imports: `import re`, `import re as regex`, `from re import compile, sub`. One import table serves the subprocess calls (`PY_CALLS`) and the `re` functions; today's scanner (two RegExps over the text) moves into it. A call is read from the lexer's tokens (a name, `.`, a name, `(`) and its name compared with the table as a string. This replaces `callRe`, the RegExp built from the script's names, which the regex guard allows today as an exception to "no source of a RegExp holds a name of a script".

The first argument is a pattern when it is string literals only: one literal or several joined by implicit concatenation (`r'\d+' r'\.' '\n'`, each with its own prefix), over several lines too. A name, `+`, `%`, `.format` or a call gives no region in step 1 (section 9 has what is left out).

### 4.2 One lexer, one value

The extractor scans Python with ad hoc pieces today: `pyString` (prefixes and quotes), `pyClose` and `pySplit` (brackets and arguments), and two escape tables, `pyUnescape` (argument lists) and the loop in `pyScript` (shell strings). The plan makes one source:

- **`pyValue(literal)`**: the value of a string literal, the source range of each character of the value (`offs`, as `pyUnescape` has), and its holes. Both extractors read it; the shell writer still writes a `\n` of the value as `;`, after the value is made.
- **Escapes (step 1)**: all of Python's: `\\`, `\'`, `\"`, `\a`, `\b`, `\f`, `\n`, `\r`, `\t`, `\v`, octal `\0` to `\377` (today `\0` alone, so `"\012"` reads as NUL and "12"), `\xhh`, and in str literals `\uXXXX`, `\UXXXXXXXX`, `\N{name}`; a backslash-newline joins the lines; an unknown escape keeps the backslash. Raw literals keep every backslash, and a raw literal cannot end in an odd number of backslashes. Without the full table, `"\bfoo\b"` would be read as word boundaries; Python makes them backspaces.
- **The lexer (issue 3)**: strings, comments, brackets, names and f-string nesting by the 3.12 rules (PEP 701: quotes of the same kind inside a field), tested against Python's own `tokenize` (section 7). It replaces `pyString`, `pyClose` and `pySplit`.
- **Positions**: a pattern character's place in the document is the line and column of its first source offset; a token's end is the end of its last character's source range. `placeEmbedded` reads that map.

### 4.3 f-strings

Issue 1 gives an f-string pattern no region. Issue 3 reads each field as a hole (`holeToken`, place `regex`; src/embedded/types.ts), whose text says what holds whatever the value is (`holeText`). `{{2}}` is the literal `{2}`, so a `{2}` quantifier. A field `{re.escape(x)}` is a hole whose value is literal text: its text says so.

## 5. Flags and functions

### 5.1 The functions

A table in src/hosts/python.ts, beside the import table, gives each function's positional parameters and what it adds to the pattern:

| Function | Parameters | Adds |
| --- | --- | --- |
| `compile` | `pattern, flags` | nothing |
| `search` | `pattern, string, flags` | nothing |
| `match` | `pattern, string, flags` | an anchor at the start |
| `fullmatch` | `pattern, string, flags` | anchors at both ends |
| `findall`, `finditer` | `pattern, string, flags` | nothing |
| `split` | `pattern, string, maxsplit, flags` | nothing |
| `sub`, `subn` | `pattern, repl, string, count, flags` | nothing |

The top row of a `match` says the pattern must match at the start; of a `fullmatch`, the whole string. Methods of a compiled pattern (`PAT.sub(repl, s)`) take no pattern and no flags; issue 5 links them to `PAT = re.compile(…)`.

### 5.2 The flags

A flags argument, given by keyword (`flags=re.X`) or in its slot, is read when it is `0`, `re.NOFLAG` (3.11+), or names of `re` joined by `|`: short (`re.I`) or long (`re.IGNORECASE`), through the file's import names. Anything else makes every option "not known", and a text that depends on one says it depends on the flags.

Inline flags: `(?aiLmsux)` at the start sets them for the whole pattern; `(?i:…)` and `(?-i:…)` inside a group. A global flag elsewhere is an error (3.11+).

`re.VERBOSE` (`re.X`, `(?x)`) is read: whitespace is dropped except in a class or after a backslash (`\ ` is a space); `#` outside a class and not escaped starts a comment to the end of the line, a comment token. `a* ?` is an error ("multiple repeat"); `a{1, 3}` is the literal text `{1, 3}`. A newline in a non-raw literal (`"a\nb"`) is whitespace there. The PCRE `(?x)` stays unread (docs/backlog-archive.md, PCRE gaps).

A bytes pattern (`rb'…'`) has ASCII classes, and `\u`, `\U`, `\N` are errors in it. `re.L` is said (bytes only, the locale decides), with no example.

### 5.3 Pitfalls of the call and of the string

- **A flag in the count's slot:** `re.sub(p, r, s, re.I)` passes 2 as `count` and stays case-sensitive; the same for `split`'s `maxsplit` and `subn`. A Warning at the argument. Since 3.13, Python deprecates passing these as positional arguments (a DeprecationWarning).
- **Escapes of a non-raw literal:** `"\b"` is a backspace (a Warning: a pattern that cannot match where the author meant a word boundary); `"\d"` is an invalid escape of the string, kept as `\d` with a SyntaxWarning since 3.12 (a Warning that names the `r` prefix).

## 6. Examples

The examples run through `toJsRegex(src, 'python', opts)` (src/examples/regex.ts), then `regexExamples` and the guarded engine (`scriptRegex`, src/examples/regexguard.ts), as every regex example does. The example kind is `regex`, so `examples.disabled` turns them off with the others.

The python branch of `toJsRegex`: VERBOSE is stripped first; `(?P<n>` becomes `(?<n>` (pcreToJs does this already); `(?P=n)` becomes `\k<n>`; `\A` becomes `^`; `\Z` becomes `$` without `m`; `$` becomes `(?=\n?$)` (the `perlEnd` path, which today maps `\Z` the same way: Python needs `$` alone); `{,n}` becomes `{0,n}`. Refused: atomic groups, possessive quantifiers, conditionals, `\N{…}`, a backreference to a group that may not take part, and every option that is not known.

The samples are ASCII without newlines, where Unicode `\d`, `\w`, `\s`, `\b` and case folding agree with JavaScript.

Per function:

- `search`, `match`, `fullmatch`, `compile`: a text that matches and one that does not, with the function's anchors.
- `sub`, `subn`: an input and its output, for a literal template (`\1`, `\g<name>`, `\g<0>`, issue 5); none for a function as the replacement.
- `split`, `findall`: the list Python gives, with tuples when the pattern has groups.

When the subject argument is a string literal, it is the input, labelled as that argument (`streamLabel`, src/examples/source.ts). Otherwise the text is made up, and its label says so.

## 7. Tests against python3

The tests run `python3 -I` as a separate program (PSF licence; nothing is vendored or bundled). Without it they are skipped; `BASH_EXPLAINER_PYTHON=1`, set in CI, makes that fail, as `BASH_EXPLAINER_PYYAML` does. Each table runs in one process, its rows given as JSON in a file through test/support/run.ts.

- **Validity:** rows of a pattern and its flags. Python's `re.compile` raises or not, with its message and position; we give an error token at that position or none. A FutureWarning is a Warning token.
- **Behaviour:** rows of a pattern, flags, a function and a subject. Where we give an example, its output equals Python's result.
- **Values of literals:** fixture files under test/fixtures/python/ (not test/fixtures/hosts/, the maintainer's playground). `tokenize` and `ast.literal_eval` give each string token's range and value; `pyValue` must give the same.
- **The corpus:** where the installed standard library is there, every `re.*` call with a literal pattern in it is read without reaching a failure boundary. It is not pinned to counts, which change with the release.

Behaviour that differs between releases is left out of the tables and tested on its own, with the release in the row (section 8).

## 8. Versions

One version: the current stable release. A text says what that release does. Where a construct's meaning or validity changed in a release still in use, a catalog note says so with the release as a parameter:

- `(?>…)` and possessive quantifiers: since 3.11 (an error before).
- Global flags not at the start: an error since 3.11 (a DeprecationWarning before).
- `re.NOFLAG`: since 3.11.
- Positional `count`, `maxsplit` and `flags`: deprecated since 3.13.
- `\z`: since 3.14, if its documentation confirms it.

The differential tests run the `python3` on PATH (3.12 on CI's Ubuntu 24.04). A row whose behaviour depends on the release says which releases it holds for, and the test skips it on others. The release named "current stable" is one constant beside the flavor's tables, so a newer release changes one place.

## 9. Left out

- The `regex` module (maintainer's decision).
- Patterns built at run time: `+`, `%`, `.format`, a call, a name, except one `re.compile` assigned to a name in the same file (issue 5). Their place is said as "not known", not guessed.
- `re.L`'s locale, Unicode case folding and Unicode classes in examples: examples are ASCII.
- Checking the subject's type (str against bytes).
- `re.Scanner`, `re.template`, `fnmatch.translate`, and regexes of other libraries.
- A pattern on a line a shell region holds (2.2).
- Other languages' regexes. The design admits another `LanguageRegion` language, but none is planned.

## 10. Steps

Each step is one PR with its tests, and the first one gets an independent review.

1. **Language regions** (#748): `Extracted.languages`, `partAt`, the seam in `explainDocumentLine`, `explainLanguageLine` with `placeEmbedded`, the split of `tokenErrorNotes`, the reading root, the chip's `language`, `hasShell`; `re.*` calls and `re.compile` with a literal pattern (raw or not, concatenated) in `.py` files, also with no subprocess call; the minimal `python` flavor (the escape table, `\Z`, `$`, `(?P<>)`, `(?P=)`, conditionals, the errors of section 3); `pyValue` with the full escape table; the import table and calls read without a RegExp of the script's names; the validity differential; the rows of sources.md.
2. **Flags** (#749): the flags argument, inline flags, VERBOSE with comment tokens, `re.A` and bytes patterns, the flag in the count's slot.
3. **The literal** (#750): the lexer tested against `tokenize`, f-string holes, `re.escape` in a field, the pitfalls of non-raw escapes.
4. **Examples** (#751): the python branch of `toJsRegex`, examples per function, the behaviour differential.
5. **Templates and compiled patterns** (#752): `\1`, `\g<name>`, `\g<0>` in `repl`, with their examples; methods of a compiled pattern linked to its `re.compile` in the same file.
6. **Detection on the web page** (#753): web/ and src/hosts/detect.ts recognise a pasted Python file by `import re` with an `re.` call, as they do for `subprocess`.

## 11. Open questions

- **Error tokens of the shell flavors.** Python's pattern errors are problems from step 1. The same errors in `grep -P`, `sed` or `[[ =~ ]]` patterns are tokens with no mark, so not problems. Making them problems would be the same rule everywhere, and new Errors in shell files. Proposal: a follow-up issue after step 1, not part of this plan.
- **"Current stable".** The texts follow the newest release, but CI's `python3` is 3.12. Proposal: the texts say what 3.12 and later agree on, with the notes of section 8 for 3.13 and 3.14. A newer `python3` in CI waits until a row needs it.
