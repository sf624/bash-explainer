// A line of a part of a host file in another language than the shell's (docs/design/python-regex.md, 2.5): the pattern of a call
// of Python's `re`. There is no shell tree, state or command around it, so no `Explainer`: the language's reader reads the text,
// `placeEmbedded` places its tokens through the literal's map, and `finishLine` (src/linefinish.ts) finishes the line as it
// finishes a shell line. `explainDocumentLine` (src/document.ts) calls it within the same boundary and budget as a shell line.
import type { Example, ExplainOptions, LineExplanation, NoteAnchor, Pos, Span, Token } from '../analyzer-types';
import { explainRegex, flavorName } from '../embedded/regex';
import { PYTHON_SINCE } from '../embedded/regex-python';
import { type EmbeddedToken, hasHole, HOLES } from '../embedded/types';
import { exampleRun, notComputed } from '../examples/commands';
import { pythonCallExample, type PyText } from '../examples/python-calls';
import { toJsRegex } from '../examples/regex';
import { fillHoles, holeSink, holesRead } from '../explain/holes';
import { placeEmbedded } from '../explain/nodes';
import type { Lang } from '../i18n';
import { codeSpan, shorten } from '../label';
import { finishLine, keptExamples, tokenErrors, wantsKind } from '../linefinish';
import { basisGate, type Fact, fact, type Note, said } from '../messages';
import { tokenSaid } from '../messages-tokens';
import { noteOfFact, sayAt } from '../noteanchors';
import { languageReading } from '../reading';
import type { LanguageRegion, LiteralSource, ReParam } from './index';
import { reCallOf, reReturns } from './python';
import { flagsAsCount, patternOf } from './scripts';

/** The explanations of each region, by the language and the options they were made with: each line of a region has the same. */
const made = new WeakMap<LanguageRegion, Map<string, LineExplanation>>();

/**
 * The explanation of `line` of `region`, a part of the document whose lines are `lines`. A part over several lines is explained
 * once, whole, and each of its lines has the same tokens and anchors, so that its problems are each said once (`noteIssues`).
 */
export function explainLanguageLine(region: LanguageRegion, lines: readonly string[], line: number, lang: Lang, opts: ExplainOptions): LineExplanation {
  let byKey = made.get(region);
  if (!byKey) made.set(region, (byKey = new Map()));
  const key = JSON.stringify([lang, opts]);
  let ex = byKey.get(key);
  if (!ex) byKey.set(key, (ex = explained(region, lines, lang, opts)));
  return ex.line === line ? ex : { ...ex, line };
}

const samePos = (a: Pos, b: Pos): boolean => a.line === b.line && a.character === b.character;

/** The text of the document between two places. */
function between(lines: readonly string[], a: Pos, b: Pos): string {
  if (a.line === b.line) return lines[a.line].slice(a.character, b.character);
  return [lines[a.line].slice(a.character), ...lines.slice(a.line + 1, b.line), lines[b.line].slice(0, b.character)].join('\n');
}

function explained(region: LanguageRegion, lines: readonly string[], lang: Lang, opts: ExplainOptions): LineExplanation {
  const { call } = region;
  const source = patternOf(region);
  // (A call whose pattern is not literals has the tokens of its arguments only: `flagsAsCount`.)
  const pattern = source && patternToken(region, source, lines, lang);
  const top = pattern?.token;
  const args = argumentTokens(region, lines, lang);
  const tokens = args.tokens;
  const pitfalls = [...(pattern?.pitfalls ?? []), ...args.pitfalls];
  // (In the order of the text: a keyword argument may come before the pattern.)
  const items = [...(top ? [top] : []), ...tokens].sort((a, b) => a.span.start.line - b.span.start.line || a.span.start.character - b.span.start.character);
  // (No example of a pattern Python refuses, nor of one with a part not known.)
  const examples = source && top && wantsKind(opts, 'regex') && !hasHole(source.value) && !top.children.some(hasError) ? callExamples(region, source, lines, lang) : [];
  const anchors: NoteAnchor[] = [];
  const data = new Map<string, Note>();
  const ex = finishLine({ line: region.lines[0], items, own: items, rested: [], context: [{ label: region.label[lang === 'ja' ? 0 : 1], line: region.lines[0] }], origin: 'embedded' }, opts, () => {
    const errors = tokenErrors(lang, items, (n, span) => sayAt(anchors, data, n, span));
    // (The pitfalls of the call are catalog facts, through the gates of `notes.pitfalls` and `notes.basis`, as a shell line's.)
    const facts = pitfalls.filter((p) => said([p.fact], opts.pitfalls).length);
    const notes = [...errors, ...facts.map((p) => sayAt(anchors, data, noteOfFact(p.fact), p.span))];
    const kept = facts.map((p) => basisGate(p.fact, opts.basis));
    return { notes, noteInfo: notes.map((n) => basisGate(data.get(n)!, opts.basis)), facts: kept, anchors, marked: { facts: kept, anchors }, examples: keptExamples(examples, opts, lang) };
  });
  ex.code = region.host.kind;
  if (opts.reading && top) ex.reading = languageReading(ex.items.find((t) => t.language)!, call.written, flavorName(region.flavor, lang));
  return ex;
}

const hasError = (t: Token): boolean => t.kind === 'error' || t.children.some(hasError);

/**
 * The example of the call (docs/design/python-regex.md, section 6), under its pattern: what it matches, or what it gives back for its
 * subject (src/examples/python-calls.ts), with the pattern as JavaScript (`toJsRegex`), within the line's budget; none where the
 * pattern or the call has what the example cannot say.
 */
function callExamples(region: LanguageRegion, source: LiteralSource, lines: readonly string[], lang: Lang): Example[] {
  const title = lang === 'ja' ? '例' : 'Example';
  return exampleRun('regex', () => {
    const regex = toJsRegex(source.value, 'python', { python: region.options! });
    if (!regex) return [];
    const text = (role: ReParam): PyText | 'unknown' | undefined => {
      const a = region.args.find((r) => r.role === role);
      return a && (a.literal ? { value: a.literal.value, bytes: !!a.literal.bytes } : 'unknown');
    };
    // (`count` or `maxsplit`: a number written, or flags in its slot, whose value it is: `flagsAsCount`.)
    const n = region.args.find((a) => a.role === 'count' || a.role === 'maxsplit');
    const written = n && between(lines, n.span.start, n.span.end);
    const count = !n ? 0 : n.flags && !n.flags.unknown.length ? n.flags.value : /^(?:0|[1-9]\d*)$/.test(written!) ? Number(written) : 'unknown';
    const { name, written: call } = region.call;
    const ex = pythonCallExample({ written: call, returns: reReturns(name), anchors: reCallOf(name).anchors, regex, bytes: region.options!.bytes, subject: text('string'), repl: text('repl'), count }, lang);
    return ex ? [{ ...ex, anchor: source.span }] : [];
  }, (id) => [{ ...notComputed('regex', title, lang, id), anchor: source.span }]);
}

/**
 * The token of the pattern's literals, with the tokens the language's reader makes of its value at their places in the file, and the
 * pitfalls of its strings (`stringPitfalls`). A field of an f-string is a hole (docs/design/python-regex.md, 4.3): the reading stands
 * where the reader claims each hole and finds no error (`holesRead`), and its holes get the catalog's texts (`fillHoles`), each risk
 * once; else the pattern is not read, as a shell word whose reading a value decides.
 */
function patternToken(region: LanguageRegion, source: LiteralSource, lines: readonly string[], lang: Lang): { token: Token; pitfalls: { fact: Fact; span: Span }[] } {
  const { call } = region;
  // (Where an offset of the value is: the place of its character, or after the last one for an end.)
  const at = (offset: number, isEnd: boolean): Pos => (isEnd && offset > 0 ? source.to[offset - 1] : source.at[offset]);
  // (`gaps[k]`: how many characters up to `k` do not follow the one before in the source: the first of a literal after another,
  // `r'a' r'b'`, or after a backslash-newline. A token whose characters a gap parts has quotes or a prefix between them in the
  // source, so its label is its value, with each field as written.)
  const { holes } = source;
  const written = (c: string): string => holes![c].written;
  const gaps = [0];
  for (let k = 1; k < source.value.length; k++) gaps.push(gaps[k - 1] + (samePos(source.to[k - 1], source.at[k]) ? 0 : 1));
  const label = (a: number, b: number): string => (b - 1 > a && gaps[b - 1] > gaps[a] ? source.value.slice(a, b).replace(HOLES, written) : between(lines, at(a, false), at(b, true)));
  let read = explainRegex(source.value, region.flavor, lang, { tool: 'python', python: region.options! });
  let unread: string[] | undefined;
  if (holes) {
    const { at: all, open, error } = holesRead(source.value, read);
    if (error || open.length) {
      unread = [...new Set((open.length ? open : all).map((k) => codeSpan(written(source.value[k]))))];
      read = [];
    } else {
      // (A field `{re.escape(x)}` is text, whatever its value is.)
      const escaped = (t: EmbeddedToken): EmbeddedToken => ({ ...t, ...(t.hole ? { hole: { ...t.hole, escaped: holes[t.hole.of ?? source.value[t.start]].escaped } } : {}), children: t.children.map(escaped) });
      read = fillHoles(holeSink(lang, new Map(), false), read.map(escaped), source.value, written);
    }
  }
  const pitfalls = stringPitfalls(source, read, lines, lang);
  // (A kept backslash is quoted with the character of the source after it, which may be a field's `{`: `"\{"` is what Python warns of.)
  const kept = [...new Set((source.escapes ?? []).filter((e) => e.risk === 'kept').map((e) => {
    const { line, character } = source.to[e.at];
    return '\\' + [...lines[line].slice(character, character + 2)][0];
  }))];
  const children = read.map((t) => placeEmbedded(t, at, label, 'embedded'));
  const explanation = tokenSaid(lang, 'python-regex-pattern', { call: call.written, ...reCallOf(call.name), ...(unread ? { unread } : {}) })
    + (kept.length ? (lang === 'ja' ? '。' : '. ') + tokenSaid(lang, 'python-regex-string-kept', { written: kept.map(codeSpan), since: PYTHON_SINCE.invalidEscape }) : '');
  return {
    token: { kind: 'string', label: shorten(between(lines, source.span.start, source.span.end)), span: source.span, children, origin: 'embedded', language: region.language, explanation },
    pitfalls,
  };
}

/**
 * The pitfalls of the strings of a pattern (docs/design/python-regex.md, 5.3): the first `\b` that a string makes a backspace, and
 * the first octal escape it makes a character (`\1`), where a regex would read a word boundary or a group's number: outside a set,
 * a token of the reader that starts with its `[` (in a set, `[\b]` and `[\1]` are those characters to a regex too).
 */
function stringPitfalls(source: LiteralSource, read: readonly EmbeddedToken[], lines: readonly string[], lang: Lang): { fact: Fact; span: Span }[] {
  const out: { fact: Fact; span: Span }[] = [];
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
    if (!e) continue;
    const span = { start: source.at[e.at], end: source.to[e.at] };
    const code = source.value.codePointAt(e.at)!;
    out.push({ fact: risk === 'backspace' ? fact(lang, 'python-regex-string-backspace') : fact(lang, 'python-regex-string-octal', { written: between(lines, span.start, span.end), code: 'U+' + code.toString(16).toUpperCase().padStart(4, '0') }), span });
  }
  return out;
}

/**
 * The tokens of the call's arguments other than the pattern (docs/design/python-regex.md, 5.2 and 5.3): each flag a flags argument
 * names, with what it does, and one token for each part of it not known; and flags in the slot of `count` or `maxsplit` (`flagsAsCount`),
 * a token and the pitfall, which says the deprecation of the slot where the flags are in it, not by keyword.
 */
function argumentTokens(region: LanguageRegion, lines: readonly string[], lang: Lang): { tokens: Token[]; pitfalls: { fact: Fact; span: Span }[] } {
  const tokens: Token[] = [];
  const pitfalls: { fact: Fact; span: Span }[] = [];
  const token = (span: Span, kind: Token['kind'], explanation: string): Token => ({ kind, label: shorten(between(lines, span.start, span.end)), span, children: [], explanation });
  for (const a of region.args) {
    if (a.role === 'flags') {
      const unknown = (span: Span) => tokens.push(token(span, 'option', tokenSaid(lang, 'python-regex-flags-unknown', { written: shorten(between(lines, span.start, span.end)) })));
      if (!a.flags) unknown(a.span);
      else {
        for (const n of a.flags.names) tokens.push(token(n.span, 'option', tokenSaid(lang, 'python-regex-flag', { written: n.written, flag: n.flag })));
        a.flags.unknown.forEach(unknown);
      }
    } else if (flagsAsCount(a)) {
      // (`re.sub(p, r, s, re.I)`: the flag's value is the count, and the pattern gets no flag.)
      const param = a.role as 'count' | 'maxsplit';
      const { value } = a.flags!;
      const written = shorten(between(lines, a.span.start, a.span.end));
      tokens.push(token(a.span, 'argument', tokenSaid(lang, 'python-regex-flags-as-count', { written, param, value })));
      pitfalls.push({ fact: fact(lang, 'python-regex-flag-as-count', { written, call: region.call.written, param, value, ...(a.keyword ? {} : { since: PYTHON_SINCE.positionalCount }) }), span: a.span });
    }
  }
  return { tokens, pitfalls };
}
