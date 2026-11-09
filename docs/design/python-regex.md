# Python regular expressions

The plan for explaining the patterns of Python's `re` module in `.py` files: `re.search(r'^\d+$', s)` gets the tokens of its pattern, as a `grep -P` pattern does in a shell line. It is the first part of a host file that is not shell code, so most of this page is about how such a part enters the products without a second source of any fact.

Status: Tracked in #763, #759, #748, #760, #749, #750, #751, #752, #753.

The maintainer decided on 2026-11-08:

- The patterns are shown in the panel and the hover, and their errors and pitfalls in Problems, in VS Code and on the web page, like shell lines.
- The third-party `regex` module is out of scope.
- One Python version: the current stable release. Where a construct's meaning or validity depends on the release, a note says so. There is no `pythonVersion` setting.
- The issues go in Next, after the Bazel items (#732 to #744). This page is reviewed before the first step, since the first non-shell part touches every product.

The research behind it (Python 3.12.3, the installed standard library and dist-packages: 1,862 `re.*(` calls, 66% with a literal first argument, 909 of them raw strings) is summarised where it is used. Every behaviour this page states was checked with a local `python3`, and the version notes against the 3.15 documentation of `re`.

## 1. What a user sees

- In a `.py` file, the hover on any part of a pattern literal explains that part: `\d+`, a group, a class, an anchor.
- With the cursor on the line, the panel shows one top row, "Python regex (argument of `re.search`)", with the pattern's rows under it, at their places in the file.
- A pattern over several lines (a triple-quoted `re.VERBOSE` pattern) is explained whole on each of its lines, as a shell statement over several lines is. It gets no block outline: `blockAt` (src/ui/blockAt.ts) outlines shell blocks only.
- A pattern Python rejects is an Error in Problems, with Python's own message (`bad escape \e at position 0`). One exception: an unknown name in `\N{…}` (`\N{NOT A NAME}`, "undefined character name") is not found, since no table of Unicode names is shipped (section 3). Pitfalls are Warnings: `"\bword\b"` without `r` (two backspaces, nothing matches), `re.sub(p, r, s, re.I)` (the flag is taken as `count`).
- An example under the pattern: a text it matches and one it does not; for `sub` and `split`, an input and its output.
- The shell chip says there is no shell on such a line: "no shell (Python regex)".
- `bash-explainer file.py` and `--check` give the same, as the Language Server does.

## 2. Parts of a host file that are not shell code

### 2.1 Today

`Extracted` (src/hosts/index.ts) is shell text, line for line: a line outside every `ShellRegion` is empty, and `maps[line]` gives the original column of each shell character. `openDocument` (src/document-setup.ts) parses `Extracted.text` into the document's one tree. Every reader of `regions` takes a region as shell code:

- `explainHostedLine` and `hostIssues` (src/hosts/remap.ts), `scriptTree` and `regionShell` (src/hosts/scripts.ts);
- `autoShellAt` (src/document.ts);
- `hasShell` (src/service.ts), which gates the editor commands, the context key `bashExplainer.hasShell` and the semantic tokens;
- `documentSpans` (src/highlight.ts), the colours of a host file's regions;
- `detectKind` (src/hosts/detect.ts), which takes a pasted text with a Markdown shell block as Markdown;
- `blockAt` (src/ui/blockAt.ts), and `wrapRuns` (src/ui/wrapRuns.ts) through `maps`.

An embedded language exists only inside a shell word: `fromEmbedded(t, node, lit, origin)` (src/explain/nodes.ts) places a reader's tokens through the word's `SyntaxNode` and its `Literal`. `explainDocumentLine` (src/document.ts) gives a line in no region an empty explanation.

### 2.2 Decision: a second list, `Extracted.languages`

A part in another language is a `LanguageRegion` in a list of its own, `Extracted.languages`. It is never in `regions`, so every reader above keeps its meaning: a region is shell code. Its lines stay empty in `text` and `maps`; it adds nothing to the tree.

```ts
interface LanguageRegion {
  lines: readonly number[];              // the lines it has: the call's, from its name to its `)`, but those of another part (below)
  label: [ja: string, en: string];       // "Python regex (argument of `re.search`)"
  host: HostId;                          // { kind: 'python' }
  language: 'regex';                     // an EmbeddedLang
  flavor: 'python';
  call: { written; name; span };         // the function, how the file names it, the call's place
  args: CallArgument[];                  // its arguments as read, in the order written (section 5.1)
  options: PythonRegexOptions;           // from the flags argument, or "not known" (section 5)
}
interface CallArgument {
  role?: ReParam;                        // the parameter it binds, by slot or keyword: 'pattern', 'string', 'repl', 'count', 'maxsplit', 'flags'
  keyword: boolean;
  span: Span;                            // its value's place: a token on it, or a note anchored there
  literal?: LiteralSource;               // its value when it is string literals: the value, the place of each character (section 4)
}
```

The region is the call, not the pattern: the flags argument, the subject (#751) and the replacement (#752) are its arguments, each read where it is, and a token or a note on any of them is on a line of the region. The pattern is the argument of the role `pattern` (`patternOf`); a role is Python's parameter name, so the keyword and the slot are one fact (`RE_CALLS`). A method of a compiled pattern (`PAT.sub(repl, s)`, #752) is a region whose call has no pattern argument: its pattern comes from the `re.compile` it is linked to.

Rejected: a `ShellRegion` with a `language` field. Each of the readers above would need a test to skip it, and a new reader would get it wrong by default. Rejected too: writing the pattern into the shell text as a made-up command (`grep -P '…'`). The tree, bash-ast's test and the reading tree would then claim that bash reads it.

A line holds at most one part. Where a shell region and a pattern share a line (`if re.match(p, x): os.system('ls')`), the shell region keeps the line and the pattern is not explained. That is rare; docs/guide/limitations.md says it.

A call's lines are not all its own, since calls nest and a shell region may be an argument. The region holds the list of lines it has (`lines`), decided once by the extractor (`claimLines`, src/hosts/python.ts), each call in the order written:

1. A line of a shell region stays the shell's (`re.sub(r'a', 'b',` above `subprocess.run('ls', shell=True))`: the second line is shell code, the first and the last the call's).
2. A line of a pattern's literals is that call's. When two patterns share a line, the first written keeps it, and a call whose pattern has a line taken by rule 1 or 2 is no region.
3. Every other line of a call goes to the innermost call kept that holds it: the one that starts last, as calls nest. So `x = re.sub(r'a', 'b',` above `re.sub(r'c', 'd', s))` shows `r'a'` on its first line and `r'c'` on its second, and a call of one statement keeps all its lines (`y = re.findall(r'\d+',` above `text)` shows the pattern on both).

`hostPartAt` and the line count of the budget (`languageLines`) read `lines`; nothing else decides which call a line is.

### 2.3 One lookup per line

`hostPartAt(extracted, line)` (src/hosts/scripts.ts, beside `regionAt`) gives the shell region or the language region of a line, read once per `Extracted` like `regionAt`. (`partAt` is taken: src/ui/hoverParts.ts, the tokens at a position.) `regionAt` stays shell only. `hasShell` becomes "has something to explain": regions or languages. It is one function, and the context key and the semantic tokens read it as they do today. Python keeps its own colours (`OWN_SEMANTIC_KINDS`), so a pattern gets no semantic tokens from us, and `documentSpans` keeps reading shell regions only.

### 2.4 The seam in `explainDocumentLine`

`explainDocumentLine` asks `hostPartAt`. A language region goes to `explainLanguageLine` (src/hosts/languages.ts) inside the same `contained` boundary and the same `withinLine` call as a shell region. So a bug in it leaves a line that says so, and its examples draw on the line's one budget.

The budget's share is by the number of code lines of the document (`shareOf`, src/examples/regexguard.ts, line-budget.md), and it counts today the code lines of `doc.tree.root.text`: the shell text, where a pattern's lines are blank. A document-wide bound must count every line that can spend: the share counts the lines of the language regions too. `withinLine` takes the document's count of code lines from `ShellDocument` (made once in `openDocument`: the shell code lines plus the lines of `Extracted.languages`), so every product computes the same share. A shell line of a Python file with patterns gets a smaller share than before; nothing else changes.

### 2.5 Finishing a line, with or without a shell tree

A language line has no `Explainer`: there is no tree node, shell state or command around it, and a context over an empty tree would let every module of src/explain/ believe there is one. But the analyzer does much after the walk that has nothing to do with the tree, and a second copy of it for language lines would be a second source of what a finished line is:

- the bases and try-its of the tokens (`withTokenBases`, or `withoutBases` with `notes.basis` off, src/tokenbases.ts);
- the ids of catalog texts taken off the texts (`markSaid`, src/tokenmarks.ts);
- the facts and anchors put on their tokens (`markTokens`);
- the origin given to the tokens of a reader and the labels that echo their text dropped (`claim`, `dropLabelEcho`);
- the examples kept by the settings (`wantsExample`, src/explain/examples.ts, which reads only `cx.opts`), and the note on control characters in an example (`pictureNote`, src/ctlchars.ts);
- the summary from the tokens' texts.

Step 2 moves these out of `Analyzer.explained` (src/analyzer.ts) into one function with no `Explainer`, `finishLine` (src/linefinish.ts): it takes the line's tokens, rested texts, facts, anchors, examples and context, with the options, and returns the `LineExplanation`. `wantsExample` takes the options in place of the context. What depends on the walk stays in the analyzer: statements explained once for the document (`Whole`), the sentence, `argv`, `notPosix`, the reading tree of bash's layers. The shell path calls `finishLine` after its walk, and its explanations stay byte-identical (test/snapshot.ts). `explainLanguageLine` calls it after the reader:

- **Tokens.** The embedded reader (`explainRegex`, flavor `python`) reads `source.value`. Its tokens are placed by `placeEmbedded(t, at, label, origin)`, the half of `fromEmbedded` that takes a position function: `fromEmbedded` becomes `placeEmbedded` with `sourcePos` over `sourceIndex`, and a language line passes the literal's offset map (section 4). One function places embedded tokens. The top token spans the literal(s), with `origin: 'embedded'`, `language: 'regex'`, and its text from the catalog of token texts (src/messages-tokens.ts).
- **Errors.** A token Python rejects carries a `tokenError` mark from the catalog (src/messages-levels.ts), as shell tokens do. `tokenErrorNotes` (src/explain/line-notes.ts) is split: its walk takes a sink (`sayAt`), the `Explainer`'s or the language line's. That sink is the `anchored` helper with an anchor list and a data map, the same functions `LineExplainer.say` and `sayAt` use.
- **Facts.** The pitfalls of the call and of the string are catalog facts. They go through `said` (the `notes.pitfalls` gate) and `basisGate` (the `notes.basis` gate), as `explainHostedLine` does for bats.
- **Context.** One entry, the region's label at its first line, as a host region has.
- **Reading tree.** One root in the layer `language` (kind `language`, reader the function, `re.search`), named with `flavorName` ("Python regex", `ReadingNode.hostLanguage`), with the nodes src/reading.ts makes of embedded tokens today. Its role text at depth 2 is its own (`about.hostLanguage`, src/ui/texts.ts): no word, command or shell is around it. There is no bash layer. src/reading.ts exports the function that makes a language's nodes from its tokens; `readingTree` and the language line both call it.
- **Not made:** no sentence ("In short"), no `argv`, no `notPosix`: they are about bash's reading.
- **Several lines.** The explanation is made once per region and kept (a `WeakMap` on the region). Each line of the region returns the same tokens and anchors, so `noteIssues` reports each anchor once, as it does for a shell statement over several lines.

### 2.6 Holes without an `Explainer`

`readHoles` and `holeText` (src/explain/embedded.ts) take the `Explainer`: for the catalog's texts (`cx.text`), for what was said before on the line (`saidBefore`, over `cx.holesSaid`), and, in `readHoles`, for the command around the word (`cx.command`: a value that starts with `-`). #750 splits them. The part that checks that the reader claimed every hole and found no error, and fills each hole's text, takes a small sink, `HoleSink` (`lang`, `text(id, params)`, `saidBefore(key, value)`), which `LineExplainer` implements and the language line implements with its own map. The part about the command's options stays in the shell path. A language line has no command, so it never says "a value that starts with `-`".

### 2.7 Problems

`noteIssues` already walks every line through `explainDocumentLine`, and turns the noted anchors into problems. A language line with notes and anchors needs nothing more there. `issuesOf` keeps calling `hostIssues` for shell regions only: a language region has no dialect issues. Suppression comments (`# bash-explainer disable=…`) work as they do on any line.

Quick fixes: `noteIssues` places a rewrite's edits by offsets in `doc.tree.text` (`lineStarts(doc.tree.text)`), where a pattern's lines are blank. No pitfall of this plan offers a quick fix. One that does later ("add `r`") must place its edits by the document's own lines on a language line; `noteIssues` then takes the line starts of the part the anchor is in.

The pattern errors of the shell flavors (`grep -P '\Q'`, an unclosed `[`) are error tokens with inline texts and no mark today, so they are not problems. The Python flavor's errors are catalog entries with marks from the start. Step 0 (#763) does the same for the shell flavors first (section 11).

### 2.8 The chip

`autoShellAt` gives a new reading, `language`, on a pattern's line only; src/messages-shell.ts words it "no shell" with the region's label ("no shell (Python regex)"). A line in no part keeps today's rule over the shell regions, and in a file with no shell region it gives the existing `none`: nothing there is read as shell. A shell chosen in the chip changes nothing on a pattern's line. The readers of the reading change with it: src/ui/scope.ts (`autoShellText`, the chip's forms), web/scope-chip.ts and the panel's header (src/ui/panelView.ts).

### 2.9 The setting

The value `python` of `bashExplainer.embedded.files` turns the whole Python host on and off, regexes included: one switch per kind of file. Its description ("Python's subprocess and os.system") gains "and re patterns", in both languages. The Python extractor no longer returns early when no `subprocess` or `os` call is imported: it returns early when neither those nor `re` are. It stays one value, on by default (section 11).

### 2.10 New facts and their sources

The steps add these rows to the table of docs/design/sources.md, section 3, each with its guard:

| Fact | Source | Guard |
| --- | --- | --- |
| The parts of a host file that are not shell code | `Extracted.languages`, read through `hostPartAt` | A test that no reader of `Extracted.regions` outside src/hosts/ reads `languages`, and that `hostPartAt` is the only reader of both |
| The value of a Python string literal and the place of each character | `pyValue` (section 4) | A test that src/hosts/ has one escape table for Python strings (today `pyUnescape` and `pyScript` have one each) |
| What a Python file imports under which name | The import table of src/hosts/python.ts | The regex guard's allow-list (test/examples-regexguard.test.ts) loses the entries for src/hosts/python.ts: no RegExp is built from a name of the script |
| Where an embedded token is in the document | `placeEmbedded` | `fromEmbedded` calls it; no other function builds an embedded token's span |
| What a finished line is | `finishLine` | test/snapshot.ts byte-identical for the shell path; a test that `Analyzer.explained` and `explainLanguageLine` both call it |

## 3. The `python` flavor

`Flavor` (src/embedded/regex.ts) gains `python`, with the tool `python` and the unit `text`. It shares the PCRE paths. The twelve `st.flavor === 'pcre'` tests of the reader, and the one in src/examples/regex.ts, become predicates of what they ask (`pcreLike(st)`: PCRE or Python), so a new flavor does not repeat them. Where Python differs, the tables are keyed by flavor (each escape's meaning, whether it is valid, what JavaScript reads for it); no `if (flavor === 'python')` is spread through the reader. Its texts are catalog entries of the token texts, so the regex reader's catalog grows with this flavor; the existing inline `s(ja, en)` texts of the other flavors stay until sources.md row 14 moves them.

`RegexOptions` gains `python: PythonRegexOptions`: `ascii`, `ignorecase`, `multiline`, `dotall`, `verbose`, `locale`, `bytes`, each `true`, `false` or "not known" (a flags argument that is not a literal).

What Python reads differently from the PCRE reader today. Each was checked with Python 3.12; the version notes are from the 3.15 documentation (section 8).

- **Rejected by Python** (`re.error`, named `re.PatternError` since 3.13), accepted by the PCRE reader: `\e`, `\h`, `\G`, `\K`, `\Q`, `\p{L}`, `\k<n>`, `\x{41}`, and any other unknown ASCII-letter escape, in a class too (`[\e]`); `(?<name>…)` without `P`; `(?|…)`, `(?R)`, `(*VERB)`; a lookbehind of variable width, alternatives of unequal length included (`(?<=a|bc)`: "look-behind requires fixed-width pattern"); global flags not at the start (`a(?i)b`); `(?L)` on a str pattern; a group name defined twice; `\10` with fewer than ten groups ("invalid group reference 10").
- **Rejected with `ValueError`**, from the flags argument, not the pattern: `re.L` with a str pattern, `re.U` with a bytes pattern, `re.A | re.U`. The validity differential catches both kinds of exception, and the error token stands on the flags argument.
- **Read differently:** `\Z` is the end of the string only (the reader's table says "or before a final newline", wrong for Python); `$` without `MULTILINE` also matches before a final newline; `\d`, `\w`, `\s`, `\b` are Unicode for a str pattern, ASCII for bytes or with `re.ASCII`; `\s` of a str includes `\x1c`–`\x1f` and `\x85`; a backreference to a group that did not take part fails (`(a)?b\1` does not match `b`); `{,2}` repeats 0 to 2 times.
- **`[[:alpha:]]`** is no POSIX class. Python reads the set `[[:alpha:]` (the characters `[`, `:`, `a`, `l`, `p`, `h`, `a`, `:`), then a literal `]`, and warns (FutureWarning, "Possible nested set"): it matches `a]` or `:]`, not `a`. The token says that, at the level of a warning.
- **Read only by Python here:** `\N{EM DASH}`, `\u`, `\U` (str patterns only), octal `\101`; `(?P<name>…)`, `(?P=name)`; conditionals `(?(1)a|b)` and `(?(name)…)`; atomic groups `(?>…)` and possessive quantifiers `a++`, `a?+`, `{1,3}+`; `\z`; `(?#…)`.

`(?P=name)` and conditionals are valid PCRE too, unread today ("a PCRE construct this explainer does not read"). The shared path reads them for both flavors, so `grep -P` gains them (#760); that PR lists the explanations it changes.

A `\N{…}` name is not checked against Unicode's names: JavaScript has no table of them, and shipping one (about a megabyte) is not worth it. The token says "the character named EM DASH, if that is a Unicode name", and the example is refused. This is the one error Python finds that we do not (section 1).

## 4. The pattern literal

### 4.1 What is found

A call is found from the file's imports: `import re`, `import re as regex`, `from re import compile, sub`. One import table serves the subprocess calls (`PY_CALLS`) and the `re` functions; today's scanner (two RegExps over the text) moves into it. A call is read from the lexer's tokens (a name, `.`, a name, `(`) and its name compared with the table as a string. This replaces `callRe`, the RegExp built from the script's names, which the regex guard allows today as an exception to "no source of a RegExp holds a name of a script".

The first argument is a pattern when it is string literals only: one literal or several joined by implicit concatenation (`r'\d+' r'\.' '\n'`, each with its own prefix), over several lines too. A name, `+`, `%`, `.format` or a call gives no region (section 9 has what is left out).

### 4.2 One lexer, one value

The extractor scans Python with ad hoc pieces today: `pyString` (prefixes and quotes), `pyClose` and `pySplit` (brackets and arguments), and two escape tables, `pyUnescape` (argument lists) and the loop in `pyScript` (shell strings). Step 1 (#759) makes one source, before anything reads patterns:

- **The lexer**: strings (every valid prefix), comments, brackets, names, numbers, and f-string nesting by the 3.12 rules (PEP 701: quotes of the same kind inside a field), tested against Python's own `tokenize` (section 7). It replaces `pyString`, `pyClose` and `pySplit`, and the calls are read from its tokens. One difference is deliberate: in a literal in single quotes, a newline ends a field, in brackets too (Python 3.12 allows it), so that a literal being typed reads no further than its line. With each literal read once (by its offset), the lexer is linear in the file. Python's limits are kept, as error tokens: 200 nested brackets (a field's `{` counts) and 149 nested f-strings or t-strings.
- **`pyValue(literal)`**: the value of a string literal, the source range of each character of the value (`offs`, as `pyUnescape` has), how each is written (`kinds`: as is, by an escape, or the text of a self-documenting field), its holes, and its backslash-newlines (`joins`). `argValue(part)` joins the adjacent literals of an argument into one value (with `rest`, the code after them). Both extractors read it.
- **The structure the shell writer needs.** `pyScript` writes a Python string as shell text, and needs more than the value: an escaped `\n` becomes `;`, a real newline of a triple-quoted string stays a newline, and a backslash-newline becomes a shell continuation `\`. `offs` gives it: a character whose source range is two characters long and starts with a backslash came from an escape, one of one character is written as is, and a backslash-newline gives no character, a gap between two ranges on different lines.
- **Escapes**: all of Python's: `\\`, `\'`, `\"`, `\a`, `\b`, `\f`, `\n`, `\r`, `\t`, `\v`, octal `\0` to `\777` (in bytes, the low byte), `\xhh`, and in str literals `\uXXXX`, `\UXXXXXXXX`, `\N{name}`; a backslash-newline joins the lines; an unknown escape keeps the backslash. Raw literals keep every backslash. Without the full table, `"\bfoo\b"` would be read as word boundaries; Python makes them backspaces. `\N{name}` is a hole of its own: there is no table of Unicode names, so its character is not known; in a command string it is a placeholder of one character, quoted, and a word of an argument list with one is a placeholder (#759). The table is `escapeAt` (src/hosts/pyvalue.ts), which the lexer reads too, to know where an escape ends (`\N{…}` in an f-string is no field).
- **Positions**: a pattern character's place in the document is the line and column of its first source offset; a token's end is the end of its last character's source range. `placeEmbedded` reads that map.

### 4.3 f-strings

Until #750, an f-string pattern gives no region. #750 reads each field as a hole (`holeToken`, place `regex`; src/embedded/types.ts), whose text says what holds whatever the value is (`holeText`, through the `HoleSink` of 2.6). `{{2}}` is the literal `{2}`, so a `{2}` quantifier. A field `{re.escape(x)}` is a hole whose value is literal text: its text says so.

## 5. Flags and functions

### 5.1 The functions

A table in src/hosts/python.ts, beside the import table, gives each function's positional parameters and what it adds to the pattern:

| Function | Parameters | Adds |
| --- | --- | --- |
| `compile` | `pattern, flags` | nothing |
| `search` | `pattern, string, flags` | nothing |
| `match`, `prefixmatch` (3.15) | `pattern, string, flags` | an anchor at the start |
| `fullmatch` | `pattern, string, flags` | anchors at both ends |
| `findall`, `finditer` | `pattern, string, flags` | nothing |
| `split` | `pattern, string, maxsplit, flags` | nothing |
| `sub`, `subn` | `pattern, repl, string, count, flags` | nothing |

The top row of a `match` says the pattern must match at the start; of a `fullmatch`, the whole string. 3.15 adds `prefixmatch` as a second name of `match` and soft-deprecates `match` (no warning): the row of `prefixmatch` notes that it needs 3.15, and `match` gets no note. Methods of a compiled pattern (`PAT.sub(repl, s)`) take no pattern and no flags; #752 links them to `PAT = re.compile(…)`.

### 5.2 The flags

A flags argument, given by keyword (`flags=re.X`) or in its slot, is read when it is `0`, `re.NOFLAG`, or names of `re` joined by `|`: short (`re.I`) or long (`re.IGNORECASE`), through the file's import names. Anything else makes every option "not known", and a text that depends on one says it depends on the flags.

Inline flags: `(?aiLmsux)` at the start sets them for the whole pattern; `(?i:…)` and `(?-i:…)` inside a group. A global flag elsewhere is an error.

`re.VERBOSE` (`re.X`, `(?x)`) is read: whitespace is dropped except in a class or after a backslash (`\ ` is a space); `#` outside a class and not escaped starts a comment to the end of the line, a comment token. `a* ?` is an error ("multiple repeat"). In `a{1, 3}` the space is dropped too, and `{1,` with a space is no quantifier: the pattern is the literal text `a{1,3}`, which matches "a{1,3}", not "a{1, 3}". A newline in a non-raw literal (`"a\nb"`) is whitespace there. The PCRE `(?x)` stays unread (docs/backlog-archive.md, PCRE gaps).

A bytes pattern (`rb'…'`) has ASCII classes, and `\u`, `\U`, `\N` are errors in it. `re.L` is said (bytes only, the locale decides), with no example.

### 5.3 Pitfalls of the call and of the string

- **A flag in the count's slot:** `re.sub(p, r, s, re.I)` passes 2 as `count` and stays case-sensitive; the same for `split`'s `maxsplit` and `subn`. A Warning at the argument. The 3.13 deprecation of these positional arguments (`sub` and `split`; the documentation says nothing of `subn`) is said with it.
- **Escapes of a non-raw literal:** `"\b"` is a backspace (a Warning: a pattern that cannot match where the author meant a word boundary). `"\d"` is an invalid escape of the string, kept as `\d` with a SyntaxWarning since 3.12: Python and the linters (Pylance, ruff's W605) already say it, so we do not (section 11); the token still says that the string keeps `\d`.

## 6. Examples

The examples run through `toJsRegex` (src/examples/regex.ts), then `regexExamples` and the guarded engine (`scriptRegex`, src/examples/regexguard.ts), as every regex example does. `toJsRegex(src, flavor, opts)` takes `ignoreCase`, `sedEscapes`, `awk` and `perlEnd` today; the Python options are a new field of `opts`, `python: PythonRegexOptions`. The example kind is `regex`, so `examples.disabled` turns them off with the others.

The python branch of `toJsRegex` writes every construct whose meaning differs out in full, and sets no JavaScript `m` or `s` flag, since JavaScript's line ends include `\r`, U+2028 and U+2029, and Python's only `\n`:

- VERBOSE is stripped first.
- `(?P<n>` becomes `(?<n>` (pcreToJs does this already); `(?P=n)` becomes `\k<n>`; `{,n}` becomes `{0,n}`.
- `\A` becomes `(?<![\s\S])`, `\Z` and `\z` become `(?![\s\S])`.
- `^` becomes `(?<![\s\S])`, or with `MULTILINE` `(?:(?<![\s\S])|(?<=\n))`; `$` becomes `(?=\n?(?![\s\S]))`, or with `MULTILINE` `(?=\n|(?![\s\S]))`. The `perlEnd` path maps `$` and `\Z` alike to `(?=\n?$)`; Python's `\Z` must not take it.
- `.` becomes `[^\n]`, or with `DOTALL` `[\s\S]`.
- Refused: atomic groups, possessive quantifiers, conditionals, `\N{…}`, a backreference to a group that may not take part, and every option that is not known.

Made-up samples are ASCII without newlines, where Unicode `\d`, `\w`, `\s`, `\b` and case folding agree with JavaScript. When the subject argument is a string literal, it is the input, labelled as that argument (`streamLabel`, src/examples/source.ts). A literal subject that is not ASCII, or holds `\r`, U+2028 or U+2029, gives no example: there JavaScript and Python may part (`\w` on `é`, case folding). Otherwise the text is made up, and its label says so.

Per function:

- `search`, `match`, `prefixmatch`, `fullmatch`, `compile`: a text that matches and one that does not, with the function's anchors.
- `sub`, `subn`: an input and its output, for a template without escapes in #751, with `\1`, `\g<name>`, `\g<0>` from #752; none for a function as the replacement.
- `findall`: the list Python gives: strings without groups or with one group (the group's text), tuples with two groups or more.
- `split`: the pieces, with each group's text between them, and `None` for a group that did not take part: `re.split(r'(,)|(;)', 'a,b;c')` gives `['a', ',', None, 'b', None, ';', 'c']`.

## 7. Tests against python3

The tests run the reference Python (section 8) as a separate program (PSF licence; nothing is vendored or bundled). It is found at `$BASH_EXPLAINER_PYTHON` (a path), or as `python3` when its version is the reference; otherwise the tests are skipped, and `BASH_EXPLAINER_PYTHON_REQUIRED=1` makes that fail, as for bash 5.3. CI installs the reference with actions/setup-python in the jobs that run them and sets both. Each table runs in one process (`-I`), its rows given as JSON in a file through test/support/run.ts.

- **Validity:** rows of a pattern and its flags. `re.compile` raises `re.error` or `ValueError`, or not, with its message and position; we give an error token at that place (in the pattern, or on the flags argument) or none. A FutureWarning is a Warning token. `\N{…}` with an unknown name is the listed exception.
- **Behaviour:** rows of a pattern, flags, a function and a subject. Where we give an example, its output equals Python's result.
- **Values of literals:** fixture files under test/fixtures/python/ (not test/fixtures/hosts/, the maintainer's playground). `tokenize` and `ast.literal_eval` give each string token's range and value; the lexer and `pyValue` must give the same.
- **The corpus:** where a standard library is installed, every `re.*` call with a literal pattern in it is read without reaching a failure boundary. It is not pinned to counts, which change with the release.

## 8. Versions

The reference is Python 3.15, the current stable release on 2026-11-08 (3.15.0 was released on 2026-10-09). It is one constant, `PYTHON_REFERENCE` (src/hosts/pylex.ts, since #759), which the tests read too: a newer release changes that constant, CI's setup-python version, and the notes.

A text says what the reference does. Nothing valid in the reference is an Error. Where a construct's meaning or validity changed in a release still supported (3.11 to 3.14 on that date), a catalog note says so, with the release as a parameter:

- `(?>…)` and possessive quantifiers: since 3.11 (an error before).
- Global flags not at the start: an error since 3.11 (a DeprecationWarning before).
- `re.NOFLAG`: since 3.11.
- Positional `count` of `sub` and `maxsplit` and `flags` of `split`: deprecated since 3.13.
- `\z`: since 3.14 (an error before).
- `\B` matches an empty string since 3.14.
- `prefixmatch`: since 3.15.

The tables of section 7 run on the reference only, so each row has one expected result.

## 9. Left out

- The `regex` module (maintainer's decision).
- Patterns built at run time: `+`, `%`, `.format`, a call, a name, except one `re.compile` assigned to a name in the same file (#752). Their place is said as "not known", not guessed.
- `re.L`'s locale, Unicode case folding and Unicode classes in examples: examples are ASCII.
- A check of `\N{…}` names (section 3).
- Checking the subject's type (str against bytes).
- `re.Scanner`, `re.template`, `fnmatch.translate`, and regexes of other libraries.
- A pattern on a line a shell region holds (2.2), and a block outline for a pattern over several lines.
- Quick fixes on a pattern's line (2.7).
- Other languages' regexes. The design admits another `LanguageRegion` language, but none is planned.
- Python's control flow. A pattern is read wherever its call is: one after `sys.exit()` or in `if False:` still gets its tokens and its Error, as a shell line after `exit` would not (the shell's `stopBefore` has no Python counterpart).

## 10. Steps

Each step is one PR with its tests. Step 2 gets an independent review.

0. **Shell flavors' error texts in the catalog** (#763, decided in section 11): the error tokens of the BRE, ERE and PCRE readers get catalog `tokenError` entries, so they are problems, and the Python flavor follows a rule that is already there.
1. **One lexer, one value, one import table** (#759), a refactor users do not see: the lexer tested against `tokenize`; `pyValue` with the full escape table, read by both extractors; the import table; calls read from the lexer's tokens, and `callRe` and its two entries in test/examples-regexguard.test.ts gone. The explanations of test/fixtures/hosts/deploy.py and the snapshot of the corpus stay identical; a string with an escape read now (`\a`, octal) is listed in the PR.
2. **The seam** (#748): `Extracted.languages`, `hostPartAt`, the seam in `explainDocumentLine`, `finishLine` out of the analyzer, `explainLanguageLine` with `placeEmbedded`, the split of `tokenErrorNotes`, the budget's count, the reading root, the chip's `language`, `hasShell`; `re.*` calls and `re.compile` with a literal pattern (raw or not, concatenated) in `.py` files, also with no subprocess call; the minimal `python` flavor (the predicates of section 3, the texts of `\Z`, `$`, `(?P<>)`), with Python's table of escapes and the refusals it reads on the way (an unknown escape, an incomplete `\x`, `\u`, `\U` or `\N{…}`, an octal escape past `\377`, a reference to a group not there or still open, an unclosed `[` or `(`, a final `\`: one catalog entry, `regex-python-error`, with Python's message), held against the reference by test/regex-python-real.test.ts; the setting's description, docs/guide and CHANGELOG; the rows of sources.md. A call with a flags argument, a pattern with `(?x)` and a bytes pattern give no region until #749.
3. **Python's errors** (#760): the other rejections of section 3 as error tokens (a lookbehind of variable width, global flags not at the start, `(?<name>…)`, `(?|…)`, a group name twice, `[\d-z]`, the `ValueError`s of the flags), the validity differential over all of them, `(?P=)` and conditionals read for Python and `grep -P`. Step 2 refuses, for Python only, a quantifier with nothing to repeat (`*.txt`, `^*`) or after another (`a**`), a count that goes down (`x{2,1}`) and a `)` that closes nothing; `grep -P` refuses them too (and GNU `grep -E` the count), where the reader says nothing: this step gives the PCRE flavor the same errors.
4. **Flags** (#749): the flags argument, inline flags, VERBOSE with comment tokens, `re.A` and bytes patterns, the flag in the count's slot.
5. **The literal** (#750): f-string holes through the `HoleSink`, `re.escape` in a field, the pitfalls of non-raw escapes.
6. **Examples** (#751): the python branch of `toJsRegex`, examples per function, the behaviour differential.
7. **Templates and compiled patterns** (#752): `\1`, `\g<name>`, `\g<0>` in `repl`, with their examples; methods of a compiled pattern linked to its `re.compile` in the same file.
8. **Detection on the web page** (#753): src/hosts/detect.ts recognises pasted Python by `import re` with an `re.` call, as it does for `subprocess`.

## 11. Decisions

The maintainer decided on 2026-11-09:

- **Error tokens of the shell flavors: yes.** Python's pattern errors are problems from step 3. The same errors in `grep -P`, `sed` or `[[ =~ ]]` patterns were tokens with inline texts and no mark, so not problems. Step 0 (#763, "Invalid regexes in shell scripts become Errors (catalog token errors for the regex reader)"), a small PR before #748, gives them catalog `tokenError` entries in every flavor. It adds Errors to shell files (a pattern grep or sed rejects fails every time).
- **Which Python files, and which pitfalls: one value, `python`, on by default.** Every `.py` file with `import re` gets the features (the status bar item, the panel's button, our problems), where before only files that run commands did, so that the patterns are found without a setting. There is no value of its own (`pythonRegex`). The `"\d"` pitfall is left out: Python (a SyntaxWarning) and the linters (Pylance, ruff's W605) already say it, and the token still says that the string keeps `\d`. The `"\b"` pitfall stays: no warning and no common linter reports it.
