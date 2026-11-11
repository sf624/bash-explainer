// The languages written inside a command's words (docs/design/analyzer.md, step 6): a regex, a sed script, an awk
// program, a jq or yq filter, a glob of find, a printf, date or git format, the escapes of `$'…'`. The explainers are
// in src/embedded/ (src/embedded/registry.ts); this module gives them the command whose words are explained
// (`Explainer.command`: the regex flavour, tr's sets, the letters given), places their tokens in the source, and adds
// the worked example of the text (src/explain/examples.ts, src/explain/examples-jq.ts).
import type { ExampleKind, Span, Token, ValueReading } from '../analyzer-types';
import { rulesOf } from '../argv/parsers';
import { givenOptions, inRecords, operands, roleLanguage, roleOfWord, values } from '../argv/query';
import { DEFAULT_BASH_VERSION } from '../bashversion';
import { awkHasGnuEscapes } from '../dict/aliases';
import { YQ_SPECS } from '../dict/yq';
import { explainEscapes } from '../embedded/format';
import { type Embedded, EMBEDDED, type EmbeddedContext } from '../embedded/registry';
import { HOLES, isHole, type EmbeddedLang, type EmbeddedToken } from '../embedded/types';
import { codeSpan, shorten } from '../label';
import { countIn } from '../semantics/argwords';
import { givesElements } from '../semantics/elements';
import { awkExample } from '../examples/awk';
import { dateExample, gitLogExample } from '../examples/commands';
import { jqReadsInputs } from '../examples/jqsample';
import { grepWrap, literalRegex, toJsRegex } from '../examples/regex';
import type { RerunSpec } from '../examples/rerun';
import { sedExample, sedPattern } from '../examples/sed';
import { NO_INPUT } from '../examples/source';
import { featureWorks } from '../shellfeatures';
import { holedContent, type Literal, literalContent, literalOfMapped, removedBackslashes, sourceIndex, staticWordText } from '../staticword';
import { ancestor, field, hasError, type SyntaxNode } from '../syntax/tree';
import { commandReading, lookupKey } from '../semantics/commandread';
import { docLine, type StateModel } from '../semantics/state';
import { copyingWord, knownCopy, valueUses } from '../semantics/values';
import { finishedApart, saysProblemIn } from '../linefinish';
import type { ValueReader } from '../messages-tokens-argv';
import { type CommandContext, type CommandRead, type Explainer, memoKey } from './context';
import { awkOptions, dateRun, globExample, guardedExample, inputSource, ioExample, pushExample, programsGiven, regexExample } from './examples';
import { jqExamples, jqFormat, jqVars, yqExample } from './examples-jq';
import { fillHoles, holeSink, type HoleSink, holesRead, holeText } from './holes';
import { explainRegex } from '../embedded/regex';
import { fromEmbedded, placeEmbedded, same, sourcePos } from './nodes';
import { invalidHow } from '../arith';
import type { BashVersion } from '../bashversion';
import type { Shell } from '../dialect';
import type { Lang } from '../i18n';
import type { ReadKnown, Stop } from '../semantics/scriptstops';
import { given, givenIn, inArithmetic, lookupOf, optionValues, regexFlavor, regexFlavorOf, trContext } from './reads';
import { hostString } from './hoststrings';
import { valueNote } from './words';

/**
 * What a reader made of a word: its tokens, a note on the whole, and the source of the holes it read (`holedWord`). `value`:
 * the word is a known value read in the language (`valueReading`), whose tokens go on the value of the expansion `part`.
 */
export interface EmbeddedReading { tokens: Token[]; note?: string; holes?: Span[]; value?: { part: SyntaxNode; reading: ValueReading } }

/**
 * Explain the contents of a quoted or plain word written in another language (a regex, a sed script…), as the command
 * is given it: the text after quote removal (`literalContent`), whose tokens are placed over the source, escapes
 * included. A word that is a copy of a variable whose value the model knows is read under that value (`valueReading`);
 * any other with an expansion in double quotes is read with the expansion as a hole (`holedWord`).
 */
export function embedded(cx: Explainer, a: SyntaxNode, lang: EmbeddedLang): EmbeddedReading | undefined {
  const known = knownValueRead(cx, a, lang);
  if (known) return known;
  const lit = literalContent(a) ?? holedWord(cx, a);
  return lit && embeddedText(cx, lit, lang, a);
}

/**
 * A known value read in a language (`valueReading`): the reader's tokens, finished and kept, its note, and what bash made of the
 * word; `read`, the reader's own tokens, at their offsets in the value (`text`), which the value's assignment places on its string
 * (`assignedReading`).
 */
export interface ValueReadingMade { tokens: readonly Token[]; read: readonly EmbeddedToken[]; note?: string; part: SyntaxNode; assumes?: 'no-match'; text: string }

/** The readings of known values, by the model of the script (which holds the commands' readings), by the other inputs they read, and by the word. */
const keptValues = new WeakMap<StateModel, Map<string, WeakMap<SyntaxNode, ValueReadingMade | null>>>();

/** A line that sets none of the flags of its own reading (`LinePart`): what the document says stands. */
const DOCUMENT_ONLY: LinePart = { lineEvidence: (known) => known(), lineReached: (reached) => reached };

/**
 * The value of the word `a` read in the language `lang` its place names, by the reader a literal there has
 * (docs/design/known-values.md, 4): where the word is a plain copy of a variable whose value the model knows and bash
 * passes as it is (`knownCopy`, src/semantics/values.ts), of a command whose reading is the model's (`onModel`: not one a
 * slot runs, nor find's expression). Undefined where the reader reads nothing of it.
 *
 * It is kept for the document, by every input it reads (3.1): the model, the word, the language of the texts, the shell,
 * the bash release, the lookup's inputs, and the document's part of a fault's level (`script`, `host`, and the row where the
 * word's shell started, `Explainer.stopsFrom`: the same whichever line asks, the use's or its assignment's). A line that
 * sets flags of its own reading (`unread`, `unsure`, `sometimes`, `unreached`) reads it afresh with them, as it reads a
 * literal. No example is made here: the readers charge nothing.
 */
export function valueReading(cx: Explainer, a: SyntaxNode, lang: EmbeddedLang): ValueReadingMade | undefined {
  // (Asked only for a word of a command being read: `positional`.)
  return commandValueReading(cx, cx.command!, a, lang);
}

/** `valueReading` of the word `a` of the command `c`, as the command's own line reads it, from any line. */
function commandValueReading(cx: Explainer, c: CommandContext, a: SyntaxNode, lang: EmbeddedLang): ValueReadingMade | undefined {
  if (!c.onModel || c.parse.refused || cx.state.noShell) return undefined;
  return keptValue(cx, a, lang, (line) => readValue(cx, c, a, lang, line));
}

/**
 * The value of the unquoted `$re` on the right of `=~` read as the ERE bash reads (docs/design/known-values.md, 5): by the
 * reader of a literal right side, with no command and no spec. `[[ ]]` neither splits nor globs, so the field is the value
 * (`knownCopy`: the word model). A quoted `"$re"` is no copy of this kind: bash matches it as text. Kept like `valueReading`.
 */
export function regexValueReading(cx: Explainer, right: SyntaxNode): ValueReadingMade | undefined {
  return keptValue(cx, right, 'regex', (line) => {
    const known = knownCopy(right, cx.state);
    // (A quoted copy, `"$re"`, has the expansion inside the word: bash matches that as text, not as a regex.)
    if (!known || known.quoted) return undefined;
    const { part, value } = known;
    const reached = line.lineReached(regexReachedInDocument(cx, right));
    const tokens = explainRegex(value.text, 'ere', cx.lang, { tool: 'bash', reached });
    return { tokens: finishedApart(placeValue(tokens, part, value.text, 'regex')), read: tokens, part, text: value.text };
  });
}

/**
 * The document's part of whether an error of the regex at `n`, the right side of `=~`, is a problem: the shell gets there
 * (`documentStopAt`), and the `[[ ]]` around it parses. A line puts its own flags on top (`Explainer.reachedAt`, `lineReached`).
 */
export function regexReachedInDocument(cx: Explainer, n: SyntaxNode): boolean {
  return cx.documentStopAt(n) !== 'sure' && !hasError(ancestor(n, (a) => a.type === 'extended_test')!);
}

/** The reading of `a` for the document, by every input it reads, made by `make` with the part of the line that asks (`DOCUMENT_ONLY` for the kept one). */
function keptValue(cx: Explainer, a: SyntaxNode, lang: EmbeddedLang, make: (line: LinePart) => ValueReadingMade | undefined): ValueReadingMade | undefined {
  const { opts } = cx;
  const own = !!(opts.unread || opts.unsure || opts.sometimes || opts.unreached);
  // (A guard: such a line is a string another shell reads, or a trap's action, where `expansionValue` knows no value today.)
  /* c8 ignore next */
  if (own) return make(cx);
  let byKey = keptValues.get(cx.state);
  if (!byKey) keptValues.set(cx.state, (byKey = new Map()));
  // (The row the word's shell started on, in a host's text that holds several: a line on another row may ask, its assignment's.)
  const key = JSON.stringify([cx.lang, cx.shell, opts.bashVersion, lookupKey(lookupOf(cx)), opts.script, opts.host, cx.stopsFrom(a), lang]);
  let byWord = byKey.get(key);
  if (!byWord) byKey.set(key, (byWord = new WeakMap()));
  let read = byWord.get(a);
  if (read === undefined) byWord.set(a, (read = make(DOCUMENT_ONLY) ?? null));
  return read ?? undefined;
}

/** The reader's tokens placed on the expansion `part`: each labelled with its text in the value, which has no place of its own in the line. */
function placeValue(read: readonly EmbeddedToken[], part: SyntaxNode, text: string, lang: EmbeddedLang): Token[] {
  const start = sourcePos(part, 0);
  const end = sourcePos(part, part.text.length);
  return read.map((t) => ({ ...placeEmbedded(t, (_, isEnd) => (isEnd ? end : start), (from, to) => text.slice(from, to), 'embedded'), language: lang }));
}

function readValue(cx: Explainer, c: CommandRead, a: SyntaxNode, lang: EmbeddedLang, line: LinePart): ValueReadingMade | undefined {
  // (A placeholder of what a host pastes, `${{ env.Y }}`, has no value the script gives: `expansionValue` knows none.)
  const known = knownCopy(a, cx.state);
  if (!known) return undefined;
  const { part, value, assumes } = known;
  const ecx = embeddedContext(c, a, { lang: cx.lang, shell: cx.shell, bashVersion: cx.opts.bashVersion }, { evidence: () => cx.documentEvidenceAt(a), stop: () => cx.documentStopAt(a) }, line);
  const read = EMBEDDED[lang](value.text, ecx);
  // (A reading with no tokens may still say something of the whole: `grep -F`, a fixed string.)
  if (!read) return undefined;
  return { tokens: finishedApart(placeValue(read.tokens, part, value.text, lang)), read: read.tokens, ...(read.note ? { note: read.note } : {}), part, ...(assumes ? { assumes } : {}), text: value.text };
}

/** `valueReading` as a reader's reading of the word, with the worked example of the value made on the asking line, as for a literal. */
function knownValueRead(cx: Explainer, a: SyntaxNode, lang: EmbeddedLang): EmbeddedReading | undefined {
  const read = valueReading(cx, a, lang);
  if (!read) return undefined;
  cx.examplesAt(a, () => guardedEmbeddedExample(cx, lang, read.text, a));
  return { tokens: [], ...(read.note ? { note: read.note } : {}), ...(read.tokens.length ? { value: { part: read.part, reading: { tokens: read.tokens, ...(read.assumes ? { assumes: read.assumes } : {}) } } } : {}) };
}

/**
 * The right side of `=~` in `[[ ]]` of the binary expression `n`, where it is one word: the ERE bash reads itself
 * (docs/design/known-values.md, 5). None for another operator, or in arithmetic.
 */
export function regexRightOf(n: SyntaxNode): SyntaxNode | undefined {
  if (n.type !== 'binary_expression' || field(n, 'operator')?.text !== '=~' || inArithmetic(n) || !ancestor(n, (a) => a.type === 'extended_test')) return undefined;
  // (The parser reads what follows `=~` as one word, up to the next blank: `[[ $x =~ a b ]]` is an error after `a`.)
  return field(n, 'right')!;
}

/** A use of an assignment's value (`valueUses`), as its own line reads the value: the reading, who reads it and as what, and its line. */
interface ValueUse { made: ValueReadingMade; reader: Omit<ValueReader, 'lines' | 'glob'>; line: number }

/**
 * The use `part` (an expansion `valueUses` gives) as the line of its command reads the value (docs/design/known-values.md, 6.2):
 * the reading the use's line has, kept for the document (`keptValue`), from the command's reading on the model
 * (`commandReading`, as `readArgs` reads it) and the language its spec gives the word (`roleLanguage`); or the right side of
 * `=~`, as bash reads it. None where the use's line reads no language.
 */
function valueUse(cx: Explainer, part: SyntaxNode): ValueUse | undefined {
  const word = copyingWord(part);
  const line = docLine(part) + 1;
  const right = regexRightOf(word.parent!);
  if (right && same(right, word)) {
    const made = regexValueReading(cx, right);
    return made && { made, reader: { lang: 'regex', flavor: 'ere', by: '[[ =~ ]]' }, line };
  }
  const cmd = word.parent;
  // (A word of a command is one of its arguments: an expansion before them would be its name.)
  if (cmd?.type !== 'command') return undefined;
  const read = commandReading(cmd, cx.state, lookupOf(cx));
  const index = read.args.findIndex((w) => same(w, word));
  const found = roleOfWord(read.parse, read.spec, index);
  const lang = found && roleLanguage(found.role, read.head.fn ?? false);
  if (!lang) return undefined;
  const nodes = [...read.args];
  const c: CommandContext = { cmd: found.parse.command, args: nodes, parse: found.parse, nodes, spec: found.spec, onModel: true };
  const made = commandValueReading(cx, c, word, lang);
  if (!made) return undefined;
  // (The command as written, with the options before the word, each once: `grep -E -e` of `grep -E -e "$a" -e "$a"`.)
  const by = shorten([field(cmd, 'name')!.text, ...new Set(found.before.map((i) => nodes[i].text))].join(' '));
  return { made, reader: { lang, ...(lang === 'regex' ? { flavor: regexFlavorOf(c, index) } : {}), by }, line };
}

/**
 * What the uses of the assignment's value word `value` make of it (docs/design/known-values.md, 6.2): the uses whose state
 * carries this word (`valueUses`) and whose line reads the value in a language (`valueUse`). Where they read it one way
 * (their readers' tokens equal) and none finds an error in it, the reader's tokens placed on the string, as a literal's
 * (`staticWordText`); in any case a text naming each command, as what it reads the value, and on which lines. None where no
 * use reads it. No example: the uses' lines have them.
 */
export function assignedReading(cx: Explainer, value: SyntaxNode): { tokens: Token[]; note: string } | undefined {
  const uses = (valueUses(cx.state).get(value) ?? []).flatMap((p) => valueUse(cx, p) ?? []);
  if (!uses.length) return undefined;
  const failed = new Set(uses.filter((u) => saysProblemIn(u.made.tokens)));
  const readers = (list: readonly ValueUse[]): ValueReader[] => {
    const out = new Map<string, ValueReader & { lines: number[] }>();
    for (const u of list) {
      const glob = u.made.assumes === 'no-match';
      const key = JSON.stringify([u.reader, glob]);
      const r = out.get(key);
      // (The uses come in the order of the text: a line read twice, `-e "$a" -e "$a"`, is the last one.)
      if (!r) out.set(key, { ...u.reader, lines: [u.line], ...(glob ? { glob } : {}) });
      else if (r.lines.at(-1) !== u.line) r.lines.push(u.line);
    }
    return [...out.values()];
  };
  const ok = uses.filter((u) => !failed.has(u));
  const note = cx.text('assignment-value-read', { reads: readers(ok), errors: readers([...failed]) });
  // (One reading: the same tokens of the reader, at the same offsets of the value, and the same assumption.)
  const one = !failed.size && new Set(ok.map((u) => JSON.stringify([u.made.read, u.made.assumes]))).size === 1;
  const m = staticWordText(value, cx.shell)!;
  const lit = literalOfMapped(m, value);
  // (Where bash took a backslash away before the commands read the text, `"a\\.b"`: the quotes are here, not at the uses.)
  const taken = removedBackslashes(lit);
  const said = taken.length ? note + cx.s('。', '; ') + cx.text('embedded-backslash-removed', { taken }) : note;
  return { tokens: one ? ok[0].made.read.map((t) => ({ ...fromEmbedded(t, value, lit, 'embedded'), language: ok[0].reader.lang })) : [], note: said };
}

/**
 * The text of a word that gives one field, with each expansion in its double quotes as a hole (`holedContent`). Not where
 * no shell reads the words (Docker's exec form), where `$x` is text; nor in zsh, where `$a[1]` and `$a:t` are subscripts and modifiers the holes do not know; nor for what may give several words (the fields model:
 * `countIn`); nor for what a host pastes before the shell reads the line (`hostPasted`), which may close the quotes.
 */
function holedWord(cx: Explainer, a: SyntaxNode): Literal | undefined {
  if (cx.state.noShell || cx.shell === 'zsh' || countIn(a, cx.state)) return undefined;
  const pasted = cx.opts.hostPasted;
  return holedContent(a, (n) => !givesElements(n) && ![...n.text.matchAll(/\$\{?([A-Za-z_]\w*)/g)].some((m) => pasted?.includes(m[1])));
}

/**
 * Explain the value of an assignment that bash reads in a language of its own when it uses it (a prompt string,
 * `PS1='\u@\h:\w\$ '`): its text after quote removal, when that is known (`"\[\e[1m\]\u"`, but not `"$USER"`).
 */
export function embeddedValue(cx: Explainer, value: SyntaxNode, lang: EmbeddedLang): { tokens: Token[]; note?: string } | undefined {
  const m = staticWordText(value, cx.shell);
  return m && embeddedText(cx, literalOfMapped(m, value), lang, value);
}

/** Explain `lit.text`, which sits inside `a` as `lit` describes (e.g. after `-k` in `-k3,3n`). */
export function embeddedText(cx: Explainer, lit: Literal, lang: EmbeddedLang, a: SyntaxNode): EmbeddedReading | undefined {
  return cx.examplesAt(a, () => embeddedTextInner(cx, lit, lang, a));
}

/** Whether `a` is one of several operands of one item of the spec of `c`, which the command joins into one text. */
function joinedWord(c: CommandRead, a: SyntaxNode): boolean {
  const { nodes, parse } = c;
  const all = operands(parse);
  // (Only an operand's language asks.)
  const mine = all.find(({ word }) => same(nodes[word], a))!;
  return all.filter(({ role }) => role.spec === mine.role.spec).length > 1;
}

/** Whether the awk command `c` is gawk, or `awk`, whose examples run as gawk; mawk (and nawk) lack its regex escapes. */
function isGawk(c: CommandRead): boolean {
  return awkHasGnuEscapes(c.cmd.split(' ')[0]);
}

/**
 * Where a word a reader reads stands (docs/design/known-values.md, 3.1): how a fault there is said (`documentEvidenceAt`)
 * and the strongest stop before it (`documentStopAt`), without the flags a line sets for itself; in a host file, from the
 * row where the word's own shell started (`Explainer.stopsFrom`), whichever line asks.
 */
export interface DocumentPlace { evidence(): ReadKnown | undefined; stop(): Stop | undefined }

/** What a line makes of a `DocumentPlace` for itself (`Explainer.lineEvidence`, `lineReached`): the flags it sets for its own reading. */
export interface LinePart { lineEvidence(known: () => ReadKnown | undefined): ReadKnown | undefined; lineReached(reached: boolean): boolean }

/**
 * What the reader of the language of the word `a` of the command `c` is told (`EmbeddedContext`): the regex flavour, tr's
 * sets, the options given, from the command's reading; the language of the texts, the shell and the bash release; and where
 * the word is (`at`), with what the asking line makes of it (`line`).
 */
export function embeddedContext(c: CommandRead, a: SyntaxNode, texts: { lang: Lang; shell: Shell | undefined; bashVersion?: BashVersion }, at: DocumentPlace, line: LinePart): EmbeddedContext {
  return {
    lang: texts.lang,
    flavor: () => regexFlavorOf(c, c.nodes.findIndex((w) => same(w, a))),
    trSet: () => trContext(c, a),
    // The letters given (`-lane`: l, a, n and e; `-pi.bak`: p and i).
    letters: () => new Set(givenOptions(c.parse).map(({ role }) => role.flag.slice(1))),
    given: (...names) => givenIn(c, ...names),
    joined: () => joinedWord(c, a),
    records: () => inRecords(c.parse),
    bash: () => (c.spec.builtin ? texts.bashVersion ?? DEFAULT_BASH_VERSION : undefined),
    // (`awk` is whichever the system has: its examples run as gawk.)
    awkGnu: () => isGawk(c),
    shell: texts.shell,
    invalid: () => invalidHow(line.lineEvidence(() => at.evidence())),
    reached: () => line.lineReached(at.stop() !== 'sure'),
  };
}

function embeddedTextInner(cx: Explainer, lit: Literal, lang: EmbeddedLang, a: SyntaxNode): EmbeddedReading | undefined {
  // (A line the tool refuses runs no program: `grep -E -F PATTERN` reads the pattern in no flavour.)
  if (cx.command?.parse.refused) return undefined;
  const ecx = embeddedContext(cx.command!, a, { lang: cx.lang, shell: cx.shell, bashVersion: cx.opts.bashVersion }, { evidence: () => cx.documentEvidenceAt(a), stop: () => cx.documentStopAt(a) }, cx);
  const read = EMBEDDED[lang](lit.text, ecx);
  const holes = lit.holes ? readHoles(cx, lit, lang, a, read) : undefined;
  if (holes?.stopped) return holes.reading;
  const r = holes ? holes.read : read;
  if (!r) return undefined;
  // (A worked example would need a value made up for the hole.)
  if (!lit.holes) guardedEmbeddedExample(cx, lang, lit.text, a);
  // (Where bash took a backslash away before the command read the text, `"a\\.b"`, it says what the command is given.)
  const taken = removedBackslashes(lit);
  const bash = taken.length ? cx.text('embedded-backslash-removed', { taken }) : undefined;
  const note = bash && r.note ? r.note + cx.s('。', '; ') + bash : bash ?? r.note;
  return { tokens: r.tokens.map((t) => ({ ...fromEmbedded(t, a, lit, 'embedded'), language: lang })), note, ...(holes ? { holes: holes.spans } : {}) };
}

/** The languages that are code: a hole that stops their reader says the script depends on it, and how a value is passed as data. */
const SCRIPTS: Partial<Record<EmbeddedLang, { data?: string }>> = { sed: {}, awk: { data: '`-v name=value`' }, jq: { data: '`--arg name value`' }, yq4: {}, perl: {} };

/** The holes of the shell line of `cx` (`Explainer.holesSaid`): a newline in a regex's value may make two patterns of the command. */
const sinkOf = (cx: Explainer): HoleSink => holeSink(cx.lang, cx.holesSaid, true);

/**
 * A reading of a text with holes (`Literal.holes`). It stands only if the reader claimed every hole with a token of a hole
 * (src/embedded/types.ts) and found no error, which may be the value's to mend; else the word stays unread, with a note
 * where the text is code. The tokens have the texts of the catalog, and the source in place of each hole. `spans`: where
 * the holes are in the source.
 */
function readHoles(cx: Explainer, lit: Literal, lang: EmbeddedLang, a: SyntaxNode, read: ReturnType<typeof EMBEDDED[EmbeddedLang]>): { stopped: true; reading?: EmbeddedReading } | { stopped?: false; read: Embedded; spans: Span[] } {
  const { parse, nodes, spec } = cx.command!;
  const source = (c: string): string => lit.holes![c];
  const show = (text: string): string => text.replace(HOLES, source);
  const sink = sinkOf(cx);
  const { at, open, error } = holesRead(lit.text, read?.tokens);
  if (!read || error || open.length) {
    const script = SCRIPTS[lang];
    const named = [...new Set((open.length ? open : at).map((k) => codeSpan(source(lit.text[k]))))];
    if (!script) return { stopped: true };
    const data = sink.saidBefore(`script ${parse.command}`, named[0]) ? undefined : script.data;
    return { stopped: true, reading: { tokens: [], note: cx.text('hole-script', { values: named, command: parse.command, data }) } };
  }
  const spans = at.map((k): Span => ({ start: sourcePos(a, sourceIndex(lit, k, false)), end: sourcePos(a, sourceIndex(lit, k + 1, true)) }));
  const said = (t: EmbeddedToken, part: boolean): string => holeText(sink, codeSpan(source(t.hole!.of ?? lit.text[t.start])), t.hole!, part);
  // (The whole word is one hole: no parts for the reader to show, and what it says stands on the word, beside bash's `$x`.)
  const whole = read.tokens.length === 1 && read.tokens[0].hole && lit.text.length === 1 ? read.tokens[0] : undefined;
  // (A regex that is only the value: the word says it is a pattern, and `pattern-from-variable` (src/pitfalls.ts) what its characters do.)
  if (whole?.hole!.place === 'regex') return { spans: [], read: { tokens: [] } };
  // (A value that starts with `-` is an option of the command, where the word is its first operand and the reader reads more of it. In code, the text of the hole says what the value may be.
  // To a parser of `letters`, a word is an option only if each letter is one: never `"$a\n"` of `echo -e`, which a reader reads for its escapes, nor one of `env printf`, which has no such option.)
  const first = parse.roles.find(({ role }) => role.role === 'operand' || role.role === 'end-of-options');
  const dash = !SCRIPTS[lang] && lit.text.length > 1 && isHole(lit.text[0]) && first?.role.role === 'operand' && same(nodes[first.word], a) && !rulesOf(spec).letters && !sink.saidBefore(`dash ${parse.command}`, source(lit.text[0]))
    ? cx.text('hole-leading-dash', { value: codeSpan(source(lit.text[0])), command: parse.command }) : undefined;
  const tokens = whole ? [] : fillHoles(sink, read.tokens, lit.text, source);
  // (Where the reader's note names the value, as tr's does, this text does not again.)
  const note = [...(read.note ? [show(read.note)] : []), ...(whole ? [said(whole, !!read.note)] : []), ...(dash ? [dash] : [])].filter(Boolean).join(cx.sep());
  return { spans: whole ? [] : spans, read: { tokens, ...(note ? { note } : {}) } };
}

/** The kinds of the examples that run the embedded text on data, and may run a regex of it (a regex and a glob say so themselves). */
const RUNNERS: Partial<Record<EmbeddedLang, ExampleKind>> = { sed: 'sed', awk: 'awk', jq: 'jq', yq4: 'yq' };

/** The worked example of an embedded text that the explainer read (src/embedded/registry.ts), when its language has one. */
const SED_EXAMPLE = memoKey<true>('sedExample');

function guardedEmbeddedExample(cx: Explainer, lang: EmbeddedLang, text: string, a: SyntaxNode): void {
  guardedExample(cx, RUNNERS[lang] ?? 'regex', () => embeddedExample(cx, lang, text, a));
}

function embeddedExample(cx: Explainer, lang: EmbeddedLang, text: string, a: SyntaxNode): void {
  switch (lang) {
    case 'regex': {
      const flavor = regexFlavor(cx);
      const ignoreCase = given(cx, '-i');
      const js = flavor === 'fixed' ? literalRegex(text, ignoreCase) : toJsRegex(text, flavor, { ignoreCase });
      // (grep matches any of its patterns; the example of one of them is of the command only when it is the only one.)
      const patterns = optionValues(cx, '-e');
      if (patterns.length && (given(cx, '-f') || patterns.some((p) => p.text === undefined) || (patterns.length > 1 && given(cx, '-v')))) break;
      if (js) regexExample(cx, grepWrap(js, given(cx, '-x'), given(cx, '-w')), given(cx, '-v') ? 'inverted' : 'lines');
      break;
    }
    case 'sed': {
      // (Each -e makes the same example, of the whole script: once for a command.)
      const made = cx.memo(SED_EXAMPLE);
      if (made.has(cx.command!.nodes[0])) break;
      made.set(cx.command!.nodes[0], true);
      // (Each -e script is read with the options given before it: `sed -e 's/a+/x/' -E -e 's/(b)/\1/'` mixes BRE and
      // ERE, which the example, of one script, does not show.)
      const flavors = new Set(values(cx.command!.parse, '-e').map(({ word }) => regexFlavor(cx, word)));
      if (flavors.size > 1) break;
      const flavor = [...flavors][0] ?? regexFlavor(cx);
      // With several -e options sed runs them as one script, so the example does too.
      // (An -e whose text is not known, or a -f file, leaves the script unknown: no example.)
      const given_scripts = programsGiven(cx, '-e', '-f');
      if (!given_scripts) break;
      const scripts = given_scripts.length ? given_scripts : [text];
      const quiet = given(cx, '-n');
      // -z / --null-data: the "lines" are NUL-separated records, which the example runner does not model.
      const ex = inRecords(cx.command!.parse) ? undefined : sedExample(scripts.join('\n'), { quiet, extended: flavor === 'ere' });
      // (Each -e makes the same example, of the whole script: it belongs to the command, and is shown once.)
      if (ex) {
        cx.examplesAt(scripts.length > 1 ? cx.command!.args[0].parent! : a, () => {
          // With `-s` or `-i`, sed works on each file apart: the example shows the first (`EachFile`).
          ioExample(cx, ex.input, ex.output, {
            kind: 'sed', script: scripts.join('\n'), quiet, extended: flavor === 'ere',
            highlight: sedPattern(scripts.join('\n'), flavor === 'ere' ? 'ere' : 'bre'),
          }, inputSource(cx));
        });
      }
      break;
    }
    case 'jq': {
      // kislyuk/yq passes the filter to jq, but reads and (with -y) writes YAML.
      if (cx.command!.spec === YQ_SPECS.kislyuk) {
        yqExample(cx, text, 'kislyuk');
        break;
      }
      const nullInput = given(cx, '-n');
      const rawInput = given(cx, '-R');
      const format = jqFormat(cx);
      if (!format) break;
      const spec: Extract<RerunSpec, { kind: 'jq' }> = {
        kind: 'jq', filter: text, raw: given(cx, '-r'), join: given(cx, '-j'), slurp: given(cx, '-s') && !nullInput, vars: jqVars(cx), format,
        ...(nullInput ? { nullInput } : {}), ...(rawInput ? { rawInput } : {}),
      };
      // `-n`: jq reads no input, unless the filter's `input` or `inputs` reads it.
      const readBy = jqReadsInputs(text);
      jqExamples(cx, spec, nullInput && !readBy ? NO_INPUT : inputSource(cx), readBy);
      break;
    }
    case 'awk': {
      const opts = awkOptions(cx);
      const ex = opts && awkExample(text, opts);
      if (!ex) break;
      // (The example reads the regex as gawk does; mawk has none of `\y`, `\<`, `\w`…, so it would show what mawk does not.)
      if (!isGawk(cx.command!) && /\\[yBwWsS<>]/.test(text)) break;
      // A program of `BEGIN` rules alone reads no input.
      const src = ex.readsInput ? inputSource(cx) : NO_INPUT;
      // The names of the files a glob gives are not known, so neither is what `FILENAME` holds.
      if (/\bFILENAME\b/.test(text) && src.streams.some((st) => st.kind !== 'stdin' && (st.many || st.pipe))) break;
      ioExample(cx, ex.input, ex.output, { kind: 'awk', program: text, fs: opts!.fs, vars: opts!.vars, assigns: opts!.assigns }, src);
      break;
    }
    case 'yq4':
      yqExample(cx, text, 'mikefarah');
      break;
    case 'gitformat':
    case 'gitdate':
      pushExample(cx, gitLogExample(lang, text, cx.command!.parse, cx.command!.nodes.map((x) => literalContent(x)?.text), cx.lang));
      break;
    case 'glob': {
      // Unlike the shell, find matches a leading dot with * too; -path also matches / with *.
      // The test before the pattern: -name, -path…
      const opt = previousNamed(a).text;
      if (!/^-i/.test(opt)) {
        globExample(cx, a, text, 'value', cx.s(`例（\`${opt}\` のパターン）`, `Example (the \`${opt}\` pattern)`),
          opt === '-name' ? [cx.s('一致するファイル名', 'Matching names'), cx.s('一致しないファイル名', 'Non-matching names')] : [cx.s('一致するパス', 'Matching paths'), cx.s('一致しないパス', 'Non-matching paths')]);
      }
      break;
    }
    case 'date': {
      const run = dateRun(cx);
      if (run) pushExample(cx, dateExample(text, run, cx.lang));
      break;
    }
  }
}

/** The named sibling before `n`. */
function previousNamed(n: SyntaxNode): SyntaxNode {
  const kids = n.parent!.namedChildren;
  return kids[kids.indexOf(n) - 1];
}

/** The escapes inside `$'…'`, each with its meaning. */
export function ansiCChildren(cx: Explainer, n: SyntaxNode): Token[] {
  const lit: Literal = { text: n.text.slice(2, -1), base: 2 };
  return explainEscapes(lit.text, cx.lang, 'ansic').map((t) => fromEmbedded(t, n, lit, 'shell'));
}

/**
 * A `$'…'` string, with its escapes. In a shell without it (`FEATURES.ansiC`), what dash makes of it instead: a `$` and
 * a single-quoted string, with its value there (`ansiCWordValue`; none in POSIX sh, which may be dash or not).
 */
export function ansiCString(cx: Explainer, n: SyntaxNode): Token {
  const host = hostString(cx, n);
  if (host) return host;
  if (!featureWorks('ansiC', cx.shell)) {
    const escapes = /\\/.test(n.text);
    // (A `\'`: dash's quote ends there, and the `'` after it opens another; the word is not what the tree shows.)
    if (cx.shell === 'dash' && n.text.slice(2, -1).includes("'")) {
      return cx.tok(n, 'string', cx.text('ansi-c-dash-quote-ends'));
    }
    return cx.tok(n, 'string', cx.shell === 'dash'
      ? cx.text('ansi-c-dash', { escapes }) + valueNote(cx, n)
      : cx.text('ansi-c-not-posix'));
  }
  return cx.tok(n, 'string', cx.text('ansi-c-string') + (/\\/.test(n.text) ? valueNote(cx, n) : ''), ansiCChildren(cx, n));
}
