// A line of a part of a host file in another language than the shell's (docs/design/python-regex.md, 2.5): the pattern of a call
// of Python's `re`. There is no shell tree, state or command around it, so no `Explainer`: the language's reader reads the text,
// `placeEmbedded` places its tokens through the literal's map, and `finishLine` (src/linefinish.ts) finishes the line as it
// finishes a shell line. `explainDocumentLine` (src/document.ts) calls it within the same boundary and budget as a shell line.
import type { Example, ExplainOptions, LineExplanation, NoteAnchor, Pos, Span, Token } from '../analyzer-types';
import { flavorName } from '../embedded/flavors';
import { readRegex } from '../embedded/regex';
import { PYTHON_SINCE, pythonFlagsRefused } from '../embedded/regex-python';
import { readTemplate, type Template, type TemplateGroups, templateTokens } from '../embedded/regex-template';
import { type EmbeddedToken, hasHole, HOLES } from '../embedded/types';
import { exampleRun, notComputed } from '../examples/commands';
import { withinOwnLine } from '../examples/regexguard';
import { pythonCallExample, type PyText } from '../examples/python-calls';
import { toJsRegex } from '../examples/regex';
import { fillHoles, holeSink, holesRead } from '../explain/holes';
import { placeEmbedded } from '../explain/nodes';
import { type Lang, lineLabel } from '../i18n';
import { codeSpan, shorten } from '../label';
import { onceBy, pushAll } from '../lists';
import { finishLine, keptExamples, titledExamples, tokenErrors, wantsKind } from '../linefinish';
import { basisGate, type Fact, fact, type Note, said } from '../messages';
import { tokenSaid } from '../messages-tokens';
import { noteOfFact, sayAt } from '../noteanchors';
import { languageReading, languageReadings } from '../reading';
import { KIND_ROLES } from '../roles';
import type { CallArgument, LanguageRegion, LiteralSource, ReParam } from './index';
import { reCallOf, reReturns } from './python';
import { flagsAsCount, literalOf, patternOf, spanWithin } from './scripts';

/**
 * A call explained: its line's explanation, and for a line it shares with other calls, its token (on the call, from its name to its
 * `)`) and the tokens that go under it.
 */
interface CallMade { ex: LineExplanation; call: Token; parts: readonly Token[] }

/** The explanations of each region, by the language and the options they were made with: each line of a region has the same. */
const made = new WeakMap<LanguageRegion, Map<string, CallMade>>();

/** The explanations of each line that calls share (`together`), by the language and the options. */
const shared = new WeakMap<readonly LanguageRegion[], Map<string, LineExplanation>>();

/**
 * The explanation of `line`, whose parts are `regions` (every call that has the line, in the order written: `hostPartAt`), of a
 * document whose lines are `lines`. A part over several lines is explained once, whole, and each of its lines has the same tokens
 * and anchors, so that its problems are each said once (`noteIssues`). A line of several calls has each call's (`together`).
 */
export function explainLanguageLine(regions: readonly LanguageRegion[], lines: readonly string[], line: number, lang: Lang, opts: ExplainOptions): LineExplanation {
  const key = JSON.stringify([lang, opts]);
  if (regions.length === 1) {
    const { ex } = callMade(regions[0], lines, key, lang, opts);
    return ex.line === line ? ex : { ...ex, line };
  }
  let byKey = shared.get(regions);
  if (!byKey) shared.set(regions, (byKey = new Map()));
  let ex = byKey.get(key);
  if (!ex) byKey.set(key, (ex = together(regions, regions.map((r) => callMade(r, lines, key, lang, opts)), lines, line, lang)));
  return ex;
}

/**
 * The explanation of a call, made once. Each call has a budget of its own (`withinOwnLine`), a share of the line's by the calls of its
 * most crowded line (`LanguageRegion.crowd`): what it shows does not depend on which of its lines asked first, nor on the calls beside
 * it on that line, and the calls of a line cost no more together than one line may (docs/design/line-budget.md).
 */
function callMade(region: LanguageRegion, lines: readonly string[], key: string, lang: Lang, opts: ExplainOptions): CallMade {
  let byKey = made.get(region);
  if (!byKey) made.set(region, (byKey = new Map()));
  let m = byKey.get(key);
  if (!m) byKey.set(key, (m = withinOwnLine(() => explained(region, lines, lang, opts), region.crowd)));
  return m;
}

/** A call as an example's title names it: its text, on one line, shortened. */
function callText(region: LanguageRegion, lines: readonly string[]): string {
  return shorten(between(lines, region.call.span.start, region.call.span.end).split('\n').map((l, i) => (i ? l.trim() : l.trimEnd())).join(' '), 40);
}

/**
 * A line of several calls (`re.sub(r'a', 'b', re.sub(r'c', 'd', s))`, `P.match(s) or Q.match(s)`), as a shell line of several
 * commands: a token for each call, with its own tokens under it and a call written in its arguments too, in the order written; each
 * call's examples, titled with the call (`titledExamples`), and its notes, facts and anchors, the same objects as on its other lines.
 */
function together(regions: readonly LanguageRegion[], each: readonly CallMade[], lines: readonly string[], line: number, lang: Lang): LineExplanation {
  const roots: Token[] = [];
  const calls: Token[] = [];
  const open: Token[] = [];
  for (const m of each) {
    const t: Token = { ...m.call, children: [...m.parts] };
    // (The calls come in the order written: one inside another starts after it, and ends before it does.)
    while (open.length && !spanWithin(open[open.length - 1].span, t.span)) open.pop();
    (open.length ? open[open.length - 1].children : roots).push(t);
    open.push(t);
    calls.push(t);
  }
  for (const t of calls) t.children.sort(byStart);
  const notes: string[] = [];
  const noteInfo: Note[] = [];
  for (const { ex } of each) {
    ex.notes.forEach((n, i) => {
      if (notes.includes(n)) return;
      notes.push(n);
      noteInfo.push(ex.noteInfo[i]);
    });
  }
  const facts = onceBy(each.flatMap((m) => m.ex.facts ?? []), (f) => f.text);
  const anchors = each.flatMap((m) => m.ex.anchors ?? []);
  const examples = each.flatMap((m, i) => titledExamples(lang, m.ex.examples.map((e) => ({ ...e, target: callText(regions[i], lines) }))));
  const readings = each.flatMap((m) => (m.ex.reading ? [m.ex.reading] : []));
  const first = regions.reduce((l, r) => Math.min(l, r.lines[0]), line);
  return {
    line, summary: each.map((m) => m.ex.summary).join(' ; '), items: roots, context: [{ label: flavorName(regions[0].flavor, lang), line: first }],
    notes, noteInfo, ...(facts.length ? { facts } : {}), ...(anchors.length ? { anchors } : {}), examples, code: regions[0].host.kind,
    ...(readings.length ? { reading: readings.length === 1 ? readings[0] : languageReadings(readings) } : {}),
  };
}

const byStart = (a: Token, b: Token): number => a.span.start.line - b.span.start.line || a.span.start.character - b.span.start.character;

const samePos = (a: Pos, b: Pos): boolean => a.line === b.line && a.character === b.character;

/** The text of the document between two places. */
function between(lines: readonly string[], a: Pos, b: Pos): string {
  if (a.line === b.line) return lines[a.line].slice(a.character, b.character);
  return [lines[a.line].slice(a.character), ...lines.slice(a.line + 1, b.line), lines[b.line].slice(0, b.character)].join('\n');
}

/** A pitfall of the call or of its strings, at its place. */
type Pitfall = { fact: Fact; span: Span };

function explained(region: LanguageRegion, lines: readonly string[], lang: Lang, opts: ExplainOptions): CallMade {
  const { call } = region;
  // (The pattern: the call's literal, or for a method that of its `re.compile`, whose tokens stay on that line: a top token at the
  // method's name says where it comes from.)
  const source = patternOf(region) ?? region.compiled?.pattern;
  const read = source && readPattern(region, source, lang);
  const pattern = read && !region.compiled ? patternToken(region, source!, read, lines, lang) : undefined;
  const top = pattern?.token ?? (region.compiled && methodToken(region, lines, lang));
  const repl = literalOf(region, 'repl');
  const template = repl && readTemplate(repl.value, read?.groups, !!repl.bytes);
  const args = argumentTokens(region, lines, lang, template);
  const tokens = args.tokens;
  const pitfalls = [...(pattern?.pitfalls ?? []), ...args.pitfalls];
  // (In the order of the text: a keyword argument may come before the pattern.)
  const items = [...(top ? [top] : []), ...tokens].sort(byStart);
  // (The call's token, for a line it shares: a method's is its own top token, on the whole call.)
  const callToken: Token | undefined = region.compiled ? undefined : { kind: 'command', label: call.written, span: call.span, children: [], explanation: tokenSaid(lang, 'python-regex-call', { call: call.written, name: call.name }) };
  // (No example of a pattern or flags Python refuses, nor of a pattern with a part not known.)
  const examples = source && top && wantsKind(opts, 'regex') && !hasHole(source.value) && !read!.tokens.some(hasError) && !tokens.some(hasError) ? callExamples(region, source, top.span, template, lines, lang) : [];
  const anchors: NoteAnchor[] = [];
  const data = new Map<string, Note>();
  const ex = finishLine({ line: region.lines[0], items, own: callToken ? [callToken, ...items] : items, rested: [], context: [{ label: region.label[lang === 'ja' ? 0 : 1], line: region.lines[0] }], origin: 'embedded' }, opts, () => {
    const errors = tokenErrors(lang, items, (n, span) => sayAt(anchors, data, n, span));
    // (The pitfalls of the call are catalog facts, through the gates of `notes.pitfalls` and `notes.basis`, as a shell line's.)
    const facts = pitfalls.filter((p) => said([p.fact], opts.pitfalls).length);
    const notes = [...errors, ...facts.map((p) => sayAt(anchors, data, noteOfFact(p.fact), p.span))];
    const kept = facts.map((p) => basisGate(p.fact, opts.basis));
    return { notes, noteInfo: notes.map((n) => basisGate(data.get(n)!, opts.basis)), facts: kept, anchors, marked: { facts: kept, anchors }, examples: keptExamples(examples, opts, lang) };
  });
  ex.code = region.host.kind;
  if (opts.reading && pattern) ex.reading = languageReading(ex.items.find((t) => t.language)!, call.written, flavorName(region.flavor, lang));
  if (callToken) return { ex, call: { ...callToken, role: KIND_ROLES.command }, parts: ex.items };
  // (A method's top token is the first, at its name: `items` are in the order written.)
  const [method, ...parts] = ex.items;
  return { ex, call: { ...method, span: call.span }, parts };
}

const hasError = (t: { kind: string; children: readonly { kind: string; children: readonly unknown[] }[] }): boolean =>
  t.kind === 'error' || t.children.some((c) => hasError(c as typeof t));

/**
 * The example of the call (docs/design/python-regex.md, section 6), at `anchor`: what its pattern matches, or what it gives back for
 * its subject (src/examples/python-calls.ts), with the pattern as JavaScript (`toJsRegex`) and the template of its replacement as
 * Python applies it, within the line's budget; none where the pattern or the call has what the example cannot say.
 */
function callExamples(region: LanguageRegion, source: LiteralSource, anchor: Span, template: Template | undefined, lines: readonly string[], lang: Lang): Example[] {
  const title = lang === 'ja' ? '例' : 'Example';
  return exampleRun('regex', () => {
    const regex = toJsRegex(source.value, 'python', { python: region.options! });
    if (!regex) return [];
    const arg = (role: ReParam): CallArgument | undefined => region.args.find((r) => r.role === role);
    const subject = arg('string');
    const text: PyText | 'unknown' | undefined = subject && (subject.literal ? { value: subject.literal.value, bytes: !!subject.literal.bytes } : 'unknown');
    const repl = arg('repl');
    // (A number written; flags in the slot of `count` or `maxsplit` are their value: `flagsAsCount`.)
    const number = (a: CallArgument | undefined): number | 'unknown' | undefined => {
      if (!a) return undefined;
      if (a.flags && !a.flags.unknown.length) return a.flags.value;
      const written = between(lines, a.span.start, a.span.end);
      return /^(?:0|[1-9]\d*)$/.test(written) ? Number(written) : 'unknown';
    };
    const n = region.args.find((a) => a.role === 'count' || a.role === 'maxsplit');
    const { name, written: call } = region.call;
    const ex = pythonCallExample({
      written: call, returns: reReturns(name), anchors: reCallOf(name).anchors, regex, bytes: region.options!.bytes, subject: text,
      repl: repl && (template?.parts ? { parts: template.parts, bytes: !!repl.literal!.bytes } : 'unknown'), count: number(n) ?? 0,
      ...(arg('pos') ? { pos: number(arg('pos')) } : {}), ...(arg('endpos') ? { endpos: number(arg('endpos')) } : {}),
    }, lang);
    return ex ? [{ ...ex, anchor }] : [];
  }, (id) => [{ ...notComputed('regex', title, lang, id), anchor }]);
}

/**
 * Where each offset of a literal's value is in the file (the place of its character, or after the last one for an end), and the label
 * of a token from `a` to `b`: its source text, or where quotes or a prefix part its characters in the source (`r'a' r'b'`, a
 * backslash-newline), its value, with each field as written.
 */
function placesOf(source: LiteralSource, lines: readonly string[]): { at: (offset: number, isEnd: boolean) => Pos; label: (a: number, b: number) => string; written: (c: string) => string } {
  const at = (offset: number, isEnd: boolean): Pos => (isEnd && offset > 0 ? source.to[offset - 1] : source.at[offset]);
  // (`gaps[k]`: how many characters up to `k` do not follow the one before in the source.)
  const written = (c: string): string => source.holes![c].written;
  const gaps = [0];
  for (let k = 1; k < source.value.length; k++) gaps.push(gaps[k - 1] + (samePos(source.to[k - 1], source.at[k]) ? 0 : 1));
  const label = (a: number, b: number): string => (b - 1 > a && gaps[b - 1] > gaps[a] ? source.value.slice(a, b).replace(HOLES, written) : between(lines, at(a, false), at(b, true)));
  return { at, label, written };
}

/**
 * The tokens a reader made of a literal with fields of an f-string (docs/design/python-regex.md, 4.3), where its reading stands:
 * where the reader claims each hole and finds no error (`holesRead`), with the catalog's texts on the holes (`fillHoles`), each risk
 * once; else none, and the fields whose values decide the reading (`unread`), as a shell word whose reading a value decides.
 */
function withHoles(source: LiteralSource, read: EmbeddedToken[], lang: Lang, written: (c: string) => string): { tokens: EmbeddedToken[]; unread?: string[] } {
  const { holes } = source;
  if (!holes) return { tokens: read };
  const { at: all, open, error } = holesRead(source.value, read);
  if (error || open.length) return { tokens: [], unread: [...new Set((open.length ? open : all).map((k) => codeSpan(written(source.value[k]))))] };
  // (A field `{re.escape(x)}` is text, whatever its value is.)
  const escaped = (t: EmbeddedToken): EmbeddedToken => ({ ...t, ...(t.hole ? { hole: { ...t.hole, escaped: holes[t.hole.of ?? source.value[t.start]].escaped } } : {}), children: t.children.map(escaped) });
  return { tokens: fillHoles(holeSink(lang, new Map(), false), read.map(escaped), source.value, written) };
}

/**
 * The pattern as the reader reads it: its tokens (with the holes' texts, or none where they decide the reading: `unread`), and its
 * groups where they are known (no field adds one: each is `{re.escape(x)}`; none where it is not read), for its template.
 */
function readPattern(region: LanguageRegion, source: LiteralSource, lang: Lang): { tokens: EmbeddedToken[]; unread?: string[]; groups?: TemplateGroups } {
  const read = readRegex(source.value, region.flavor, lang, { tool: 'python', python: region.options! });
  const { tokens, unread } = withHoles(source, read.tokens, lang, (c) => source.holes![c].written);
  const sure = !unread && Object.values(source.holes ?? {}).every((h) => h.escaped);
  return { tokens, ...(unread ? { unread } : {}), ...(sure && read.groups ? { groups: read.groups } : {}) };
}

/**
 * The token of the pattern's literals, with the tokens the language's reader makes of its value at their places in the file, and the
 * pitfalls of its strings (`stringPitfalls`).
 */
function patternToken(region: LanguageRegion, source: LiteralSource, read: { tokens: EmbeddedToken[]; unread?: string[] }, lines: readonly string[], lang: Lang): { token: Token; pitfalls: Pitfall[] } {
  const { call } = region;
  const pitfalls = stringPitfalls(source, read.tokens, lines, lang);
  // (A kept backslash is quoted with the character of the source after it, which may be a field's `{`: `"\{"` is what Python warns of.)
  const kept = [...new Set((source.escapes ?? []).filter((e) => e.risk === 'kept').map((e) => {
    const { line, character } = source.to[e.at];
    return '\\' + [...lines[line].slice(character, character + 2)][0];
  }))];
  const explanation = tokenSaid(lang, 'python-regex-pattern', { call: call.written, ...reCallOf(call.name), ...(read.unread ? { unread: read.unread } : {}) })
    + (kept.length ? (lang === 'ja' ? '。' : '. ') + tokenSaid(lang, 'python-regex-string-kept', { written: kept.map(codeSpan), since: PYTHON_SINCE.invalidEscape }) : '');
  return { token: literalToken(source, read.tokens, explanation, lines, region.language), pitfalls };
}

/**
 * The token of literals (a pattern, a template), with the tokens a reader made of their value at their places in the file (`placesOf`);
 * `language`, on the pattern's, which a reading's root is.
 */
function literalToken(source: LiteralSource, read: readonly EmbeddedToken[], explanation: string, lines: readonly string[], language?: string): Token {
  const { at, label } = placesOf(source, lines);
  const children = read.map((t) => placeEmbedded(t, at, label, 'embedded'));
  return { kind: 'string', label: shorten(between(lines, source.span.start, source.span.end)), span: source.span, children, origin: 'embedded', ...(language ? { language } : {}), explanation };
}

/**
 * The top token of a method of a compiled pattern (`PAT.sub`), on its name: the line of the `re.compile` it is linked to and its
 * pattern, and what the function adds (docs/design/python-regex.md, 5.1). The pattern's own tokens are on that line.
 */
function methodToken(region: LanguageRegion, lines: readonly string[], lang: Lang): Token {
  const { call } = region;
  const { name, line, pattern } = region.compiled!;
  const span = { start: call.span.start, end: { line: call.span.start.line, character: call.span.start.character + call.written.length } };
  const explanation = tokenSaid(lang, 'python-regex-method', { call: call.written, method: call.name.slice(3), name, line: lineLabel(lang, line + 1, 'inline'), pattern: shorten(between(lines, pattern.span.start, pattern.span.end), 40), ...reCallOf(call.name) });
  return { kind: 'command', label: call.written, span, children: [], explanation };
}

/**
 * The pitfalls of the strings of a pattern (docs/design/python-regex.md, 5.3): the first `\b` that a string makes a backspace, and
 * the first octal escape it makes a character (`\1`), where a regex would read a word boundary or a group's number: outside a set,
 * a token of the reader that starts with its `[` (in a set, `[\b]` and `[\1]` are those characters to a regex too).
 */
function stringPitfalls(source: LiteralSource, read: readonly EmbeddedToken[], lines: readonly string[], lang: Lang): Pitfall[] {
  const out: Pitfall[] = [];
  // (Where the sets are: each token is looked at once, and a set's own tokens are its holes.)
  const inSet: boolean[] = [];
  const sets = (ts: readonly EmbeddedToken[]): void => {
    for (const t of ts) {
      if (source.value[t.start] === '[') inSet.fill(true, t.start, t.end);
      else sets(t.children);
    }
  };
  inSet.length = source.value.length;
  sets(read);
  for (const risk of ['backspace', 'octal'] as const) {
    // (A pattern not read says nothing of them.)
    const e = read.length ? (source.escapes ?? []).find((x) => x.risk === risk && !inSet[x.at]) : undefined;
    if (e) out.push(octalOrBackspace(source, e.at, risk === 'backspace' ? 'python-regex-string-backspace' : 'python-regex-string-octal', lines, lang));
  }
  return out;
}

/** The pitfall of the escape at `k` of a string: a backspace, or an octal escape (`\1`) that a pattern or a template reads otherwise. */
function octalOrBackspace(source: LiteralSource, k: number, id: 'python-regex-string-backspace' | 'python-regex-string-octal' | 'python-template-string-octal', lines: readonly string[], lang: Lang): Pitfall {
  const span = { start: source.at[k], end: source.to[k] };
  if (id === 'python-regex-string-backspace') return { fact: fact(lang, id), span };
  const code = 'U+' + source.value.codePointAt(k)!.toString(16).toUpperCase().padStart(4, '0');
  return { fact: fact(lang, id, { written: between(lines, span.start, span.end), code }), span };
}

/**
 * The token of a replacement written as literals that Python reads as a template (docs/design/python-regex.md, section 6): one with a
 * backslash, or with a field of an f-string, whose value may hold one; its items, from the template reader (src/embedded/regex-template.ts),
 * at their places in the file. Plain text gets none: Python puts it in as it is. And the pitfall of the first octal escape a string
 * that is not raw makes a character (`'\1'`), where the template would read a group.
 */
function templateToken(region: LanguageRegion, a: CallArgument, template: Template, lines: readonly string[], lang: Lang): { token?: Token; pitfalls: Pitfall[] } {
  const source = a.literal!;
  const read = withHoles(source, templateTokens(source.value, template, lang), lang, placesOf(source, lines).written);
  const explanation = tokenSaid(lang, 'python-template', { call: region.call.written, template: source.value.includes('\\'), ...(read.unread ? { unread: read.unread } : {}) });
  const octal = read.unread ? undefined : (source.escapes ?? []).find((e) => e.risk === 'octal');
  return {
    ...(source.value.includes('\\') || source.holes ? { token: literalToken(source, read.tokens, explanation, lines) } : {}),
    pitfalls: octal ? [octalOrBackspace(source, octal.at, 'python-template-string-octal', lines, lang)] : [],
  };
}

/**
 * The tokens of the call's arguments other than the pattern (docs/design/python-regex.md, 5.2, 5.3 and 6): the replacement, a
 * template (`templateToken`); each flag a flags argument names, with what it does, and one token for each part of it not known;
 * flags in the slot of `count` or `maxsplit` (`flagsAsCount`), a token and the pitfall, which says the deprecation of the slot of a
 * function where the flags are in it, not by keyword (a method's slot is none); and a method's `pos` and `endpos`.
 */
function argumentTokens(region: LanguageRegion, lines: readonly string[], lang: Lang, template: Template | undefined): { tokens: Token[]; pitfalls: Pitfall[] } {
  const tokens: Token[] = [];
  const pitfalls: Pitfall[] = [];
  const token = (span: Span, kind: Token['kind'], explanation: string): Token => ({ kind, label: shorten(between(lines, span.start, span.end)), span, children: [], explanation });
  for (const a of region.args) {
    const written = shorten(between(lines, a.span.start, a.span.end));
    if (a.role === 'repl' && template) {
      const t = templateToken(region, a, template, lines, lang);
      if (t.token) tokens.push(t.token);
      pushAll(pitfalls, t.pitfalls);
    } else if (a.role === 'pos' || a.role === 'endpos') {
      tokens.push(token(a.span, 'argument', tokenSaid(lang, a.role === 'pos' ? 'python-regex-pos' : 'python-regex-endpos', { written })));
    } else if (a.role === 'flags') {
      const unknown = (span: Span) => tokens.push(token(span, 'option', tokenSaid(lang, 'python-regex-flags-unknown', { written: shorten(between(lines, span.start, span.end)) })));
      if (!a.flags) unknown(a.span);
      else {
        // (Flags Python refuses with `ValueError` (`re.L` with a str pattern): the error is on the last name of a flag it names.)
        const refused = region.options && pythonFlagsRefused(region.options);
        const at = refused ? a.flags.names.filter((n) => refused.flags.includes(n.flag)).pop() : undefined;
        for (const n of a.flags.names) {
          const said = tokenSaid(lang, 'python-regex-flag', { written: n.written, flag: n.flag });
          tokens.push(n === at ? token(n.span, 'error', said + (lang === 'ja' ? '。' : '. ') + tokenSaid(lang, 'regex-python-flags-error', { message: refused!.message })) : token(n.span, 'option', said));
        }
        a.flags.unknown.forEach(unknown);
      }
    } else if (flagsAsCount(a)) {
      // (`re.sub(p, r, s, re.I)`: the flag's value is the count, and the pattern gets no flag.)
      const param = a.role as 'count' | 'maxsplit';
      const { value } = a.flags!;
      tokens.push(token(a.span, 'argument', tokenSaid(lang, 'python-regex-flags-as-count', { written, param, value })));
      pitfalls.push({ fact: fact(lang, 'python-regex-flag-as-count', { written, call: region.call.written, param, value, ...(a.keyword || region.compiled ? {} : { since: PYTHON_SINCE.positionalCount }), ...(region.compiled ? { compiled: { name: region.compiled.name, line: region.compiled.line + 1 } } : {}) }), span: a.span });
    }
  }
  return { tokens, pitfalls };
}
