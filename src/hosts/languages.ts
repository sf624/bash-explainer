// A line of a part of a host file in another language than the shell's (docs/design/python-regex.md, 2.5): the pattern of a call
// of Python's `re`. There is no shell tree, state or command around it, so no `Explainer`: the language's reader reads the text,
// `placeEmbedded` places its tokens through the literal's map, and `finishLine` (src/linefinish.ts) finishes the line as it
// finishes a shell line. `explainDocumentLine` (src/document.ts) calls it within the same boundary and budget as a shell line.
import type { ExplainOptions, LineExplanation, NoteAnchor, Pos, Token } from '../analyzer-types';
import { explainRegex, flavorName } from '../embedded/regex';
import { placeEmbedded } from '../explain/nodes';
import type { Lang } from '../i18n';
import { shorten } from '../label';
import { finishLine, tokenErrors } from '../linefinish';
import { basisGate, type Note } from '../messages';
import { tokenSaid } from '../messages-tokens';
import { sayAt } from '../noteanchors';
import { languageReading } from '../reading';
import type { LanguageRegion } from './index';
import { reCallOf } from './python';
import { patternOf } from './scripts';

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
  // (Where an offset of the value is: the place of its character, or after the last one for an end.)
  const at = (offset: number, isEnd: boolean): Pos => (isEnd && offset > 0 ? source.to[offset - 1] : source.at[offset]);
  // (`gaps[k]`: how many characters up to `k` do not follow the one before in the source: the first of a literal after another,
  // `r'a' r'b'`, or after a backslash-newline. A token whose characters a gap parts has quotes or a prefix between them in the
  // source, so its label is its value.)
  const gaps = [0];
  for (let k = 1; k < source.value.length; k++) gaps.push(gaps[k - 1] + (samePos(source.to[k - 1], source.at[k]) ? 0 : 1));
  const label = (a: number, b: number): string => (b - 1 > a && gaps[b - 1] > gaps[a] ? source.value.slice(a, b) : between(lines, at(a, false), at(b, true)));
  const children = explainRegex(source.value, region.flavor, lang, { tool: 'python' }).map((t) => placeEmbedded(t, at, label, 'embedded'));
  const top: Token = {
    kind: 'string', label: shorten(between(lines, source.span.start, source.span.end)), span: source.span, children, origin: 'embedded', language: region.language,
    explanation: tokenSaid(lang, 'python-regex-pattern', { call: call.written, ...reCallOf(call.name) }),
  };
  const anchors: NoteAnchor[] = [];
  const data = new Map<string, Note>();
  const ex = finishLine({ line: region.lines[0], items: [top], own: [top], rested: [], context: [{ label: region.label[lang === 'ja' ? 0 : 1], line: region.lines[0] }], origin: 'embedded' }, opts, () => {
    const notes = tokenErrors(lang, [top], (n, span) => sayAt(anchors, data, n, span));
    return { notes, noteInfo: notes.map((n) => basisGate(data.get(n)!, opts.basis)), facts: [], anchors, marked: { facts: [], anchors }, examples: [] };
  });
  ex.code = region.host.kind;
  if (opts.reading) ex.reading = languageReading(ex.items[0], call.written, flavorName(region.flavor, lang));
  return ex;
}
