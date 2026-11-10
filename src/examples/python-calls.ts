// The worked examples of a call of Python's `re` (docs/design/python-regex.md, section 6): what `search`, `match`, `fullmatch`
// and `compile` match, and what `sub`, `subn`, `split` and `findall` give back, as Python prints it (`repr`). The pattern comes as
// JavaScript (`toJsRegex`, src/examples/regex-python.ts) and runs on the guarded engine (`scriptRegex`), in the order Python finds
// its matches: after an empty match, the next one must not be empty where it starts (`pythonMatches`). A subject written as a literal
// is used as it is, else the text is made up and its label says so; a replacement is its template's parts as Python applies them
// (`readTemplate`), and a method's `pos` and `endpos` are followed. Only ASCII without control characters but tab and newline is shown, where JavaScript and Python read the classes and the case alike (`PY_SHOWN`), and the panel's box
// runs nothing else again. Each value is charged before it is made (`chargeSize`): past the line's budget, it is not computed.
import type { Example, ExampleSection } from '../analyzer-types';
import { pyRepr } from '../embedded/regex-python';
import type { TemplatePart } from '../embedded/regex-template';
import { pick } from '../embedded/types';
import type { ReReturns } from '../hosts/python';
import type { Lang } from '../i18n';
import { interactive } from './commands';
import { type JsRegex, regexExamples } from './regex';
import { groupFacts, PY_END, PY_SHOWN, PY_START } from './regex-python';
import { advancingFrom, chargeSize, scriptRegex } from './regexguard';
import { testStringsLabel } from './rerun';
import { argumentLabel } from './source';

/** A text of a call, as a literal gives it: its value, and whether it is bytes (`b'…'`). */
export interface PyText { value: string; bytes: boolean }

/** A call of a function of `re` with a pattern JavaScript can run, and what the example needs of its other arguments. */
export interface PythonCall {
  /** The function as written (`re.sub`), what it gives back, and the anchors it adds (`RE_CALLS`, src/hosts/python.ts). */
  written: string;
  returns: ReReturns;
  anchors?: 'start' | 'whole';
  /** The pattern without those anchors, and whether it is bytes. */
  regex: JsRegex;
  bytes: boolean;
  /** The argument `string`: a literal's text, `unknown` for another value, none where the call has none. */
  subject?: PyText | 'unknown';
  /**
   * The argument `repl`: the parts of its template as Python applies them (`readTemplate`, src/embedded/regex-template.ts), and whether
   * it is bytes; `unknown` for another value, or a template Python refuses or that has a field of an f-string; none where the call has none.
   */
  repl?: { parts: readonly TemplatePart[]; bytes: boolean } | 'unknown';
  /** `count` of `sub` and `subn`, or `maxsplit` of `split`: 0 where it is not given, `unknown` where it is not a number written. */
  count: number | 'unknown';
  /** `pos` and `endpos` of a method of a compiled pattern: a number written, `unknown` for another value, none where not given. */
  pos?: number | 'unknown';
  endpos?: number | 'unknown';
}

const shownLine = (t: string): boolean => PY_SHOWN.test(t) && !t.includes('\n');

/** A match as Python prints it: `<re.Match object; span=(4, 7), match='123'>`, the match's `repr` cut at 50 characters. */
const matchRepr = (m: RegExpExecArray, bytes: boolean): string => `<re.Match object; span=(${m.index}, ${m.index + m[0].length}), match=${pyRepr(m[0], bytes).slice(0, 50)}>`;

/**
 * The matches of `js` in `text` one after another, as `findall`, `split` and `sub` of Python find them (`limit`: at most that many,
 * 0 for all; `from`, where the first may start, a method's `pos`): from where the last one ended, and after an empty one, a match at
 * that place must not be empty (`must_advance` of its `sre`): one that is not is tried there first (`advancingFrom`), then the search
 * goes on one character further.
 */
export function pythonMatches(js: JsRegex, text: string, limit = 0, from = 0): RegExpExecArray[] {
  const all = scriptRegex(js.source, js.flags + 'g');
  const out: RegExpExecArray[] = [];
  let at = from;
  let empty = false;
  while (at <= text.length && (!limit || out.length < limit)) {
    let m: RegExpExecArray | null = empty ? advancingFrom(all, text, at) : null;
    if (!m && (!empty || at < text.length)) {
      all.lastIndex = empty ? at + 1 : at;
      m = all.exec(text);
    }
    if (!m) break;
    out.push(m);
    empty = m[0].length === 0;
    at = m.index + m[0].length;
  }
  return out;
}

/** The pattern with the anchors its function adds: `match` at the start, `fullmatch` at both ends. */
function anchored(js: JsRegex, anchors: PythonCall['anchors']): JsRegex {
  if (!anchors) return js;
  return { ...js, source: `${PY_START}(?:${js.source})${anchors === 'whole' ? PY_END : ''}` };
}

/**
 * A text with matches of `js` in it, for a call whose subject is not known: two matches between words, with or without spaces, where
 * the words add no match; or one at the start or the end of a word. None where no ASCII text matches.
 */
function madeUpText(js: JsRegex): string | undefined {
  // (With the groups' texts apart, a template that reorders them shows it: `\2 \1` of `(\w+) (\w+)` on `b cde`.)
  const ex = regexExamples(js, 3, shownLine, true);
  if (!ex) return undefined;
  const [a, b = a] = ex.matching;
  const tries = [['abc', a, 'def', b, 'xyz'], [a, 'xyz'], ['abc', a]].flatMap((parts) => [parts.join(''), parts.join(' ')]);
  const inserted = (t: string) => (t.startsWith('abc') && t.includes('def') ? [a, b] : [a]);
  return tries.find((t) => {
    const found = pythonMatches(js, t).map((m) => m[0]);
    return found.length === inserted(t).length && found.every((f, k) => f === inserted(t)[k]);
  }) ?? tries[0];
}

/**
 * What a call gives back for the subject `text`, as Python prints it; none where JavaScript's groups would not say Python's. Each
 * value is charged before it is made: a `repr` of a shown text is at most twice as long, with its quotes and a separator.
 */
function result(call: PythonCall, subject: string): string | undefined {
  const { bytes, regex } = call;
  const repr = (v: string | undefined) => {
    chargeSize(2 * (v?.length ?? 0) + 5);
    return pyRepr(v, bytes);
  };
  const groups = groupFacts(regex.source);
  // (A method's `endpos`: the string is read as if it ended there; `pos`: the search starts there, and what is before it is seen
  // by a lookbehind and `\b`, while `^` and `\A` stand only at the real start. Both are cut to the string's length.)
  const text = subject.slice(0, typeof call.endpos === 'number' ? call.endpos : subject.length);
  const from = Math.min(typeof call.pos === 'number' ? call.pos : 0, subject.length);
  if (call.returns === 'match') {
    // (`match` at `pos`, `fullmatch` there and to the end; `search` from there on.)
    const re = scriptRegex(call.anchors === 'whole' ? `(?:${regex.source})${PY_END}` : regex.source, regex.flags + (call.anchors ? 'y' : 'g'));
    re.lastIndex = from;
    const m = from > text.length ? null : re.exec(text);
    return m ? matchRepr(m, bytes) : 'None';
  }
  const count = call.count as number;
  if (call.returns === 'list') {
    if (groups.count && !groups.agree) return undefined;
    // (No group: the matches; one: its text; more: a tuple of them. A group that did not take part is an empty string.)
    const items = (from > text.length ? [] : pythonMatches(regex, text, 0, from)).map((m) => (groups.count === 0 ? repr(m[0]) : groups.count === 1 ? repr(m[1] ?? '') : `(${m.slice(1).map((g) => repr(g ?? '')).join(', ')})`));
    return `[${items.join(', ')}]`;
  }
  if (call.returns === 'pieces') {
    if (groups.count && !groups.agree) return undefined;
    // (Each group's text between the pieces, `None` for one that did not take part.)
    const items: string[] = [];
    let last = 0;
    for (const m of pythonMatches(regex, text, count)) {
      items.push(repr(text.slice(last, m.index)));
      for (let g = 1; g < m.length; g++) items.push(repr(m[g]));
      last = m.index + m[0].length;
    }
    items.push(repr(text.slice(last)));
    return `[${items.join(', ')}]`;
  }
  // (The template's parts for each match: its text, and each group's, empty for one that did not take part, as since Python 3.5.)
  const { parts } = call.repl as { parts: readonly TemplatePart[] };
  if (groups.count && !groups.agree && parts.some((p) => typeof p === 'number' && p > 0)) return undefined;
  const ms = pythonMatches(regex, text, count);
  let out = '';
  let last = 0;
  for (const m of ms) {
    const repl = parts.map((p) => (typeof p === 'number' ? m[p] ?? '' : p));
    // (A replacement many times as long as its match, many times over: `re.sub('a', 'R' * 10000, 'a' * 10000)`.)
    chargeSize(m.index - last + repl.reduce((n, p) => n + p.length, 0));
    out += text.slice(last, m.index) + repl.join('');
    last = m.index + m[0].length;
  }
  out += text.slice(last);
  return call.returns === 'replaced' ? repr(out) : `(${repr(out)}, ${ms.length})`;
}

/**
 * The example of a call of `re` (docs/design/python-regex.md, section 6), or none: for `search`, `match`, `fullmatch` and `compile`,
 * strings that match and do not (with the function's anchors), or where the subject is a literal, what the call gives back for it;
 * for `findall`, `split`, `sub` and `subn`, the subject and what the call gives back, with the template of the replacement applied.
 * None for `finditer`, a replacement that is not a literal or a template Python applies, a count, `pos` or `endpos` not written as a
 * number, `pos` or `endpos` with a subject not known, a subject or a replacement whose type is not the pattern's (Python raises
 * `TypeError`) or that holds what an example does not show.
 */
export function pythonCallExample(call: PythonCall, lang: Lang): Example | undefined {
  if (call.returns === 'iterator' || call.count === 'unknown' || call.pos === 'unknown' || call.endpos === 'unknown') return undefined;
  const fits = (t: PyText) => t.bytes === call.bytes && PY_SHOWN.test(t.value);
  if (call.returns === 'replaced' || call.returns === 'counted') {
    const { repl } = call;
    if (!repl || repl === 'unknown' || repl.bytes !== call.bytes || !repl.parts.every((p) => typeof p === 'number' || PY_SHOWN.test(p))) return undefined;
  }
  const { subject } = call;
  const bounded = call.pos !== undefined || call.endpos !== undefined;
  if (bounded && subject === 'unknown') return undefined;
  if (call.returns === 'pattern' || (call.returns === 'match' && subject === 'unknown')) return matchesExample(call, lang);
  // (A call with no subject raises `TypeError`.)
  if (subject === undefined) return undefined;
  if (subject !== 'unknown') return fits(subject) ? io(call, subject.value, true, lang) : undefined;
  const text = madeUpText(call.regex);
  return text === undefined ? undefined : io(call, text, false, lang);
}

/** The subject and what the call gives back for it, as Python prints them; `known`: the subject is the call's literal, not made up. */
function io(call: PythonCall, text: string, known: boolean, lang: Lang): Example | undefined {
  const s = pick(lang);
  const out = result(call, text);
  if (out === undefined) return undefined;
  const sections: ExampleSection[] = [
    { label: argumentLabel('string', known, lang), lines: [pyRepr(text, call.bytes)] },
    { label: s(`結果（\`${call.written}\` の戻り値）`, `Result (what \`${call.written}\` returns)`), lines: [out] },
  ];
  return { kind: 'regex', title: s('例', 'Example'), sections };
}

/** Strings that match and do not, with the function's anchors: a call whose subject is not known, or a compiled pattern. */
function matchesExample(call: PythonCall, lang: Lang): Example | undefined {
  const s = pick(lang);
  const js = anchored(call.regex, call.anchors);
  const ex = regexExamples(js, 3, shownLine);
  if (!ex) return undefined;
  const yes = ex.inside === undefined ? ex.matching : [...ex.matching, ex.inside];
  const no = ex.nonMatching;
  const w = `\`${call.written}\``;
  const title = call.returns === 'pattern' ? s('例（コンパイルしたパターンの `search` で照合した場合）', 'Example (as `search` of the compiled pattern finds it)')
    : call.anchors === 'start' ? s(`例（${w} は文字列の先頭から照合する）`, `Example (${w} matches at the start of the string)`)
      : call.anchors === 'whole' ? s(`例（${w} は文字列全体と照合する）`, `Example (${w} matches the whole string)`) : s('例', 'Example');
  const sections: ExampleSection[] = [
    { label: s('一致する文字列（例）', 'Strings that match (examples)'), lines: yes },
    { label: s('一致しない文字列（例）', 'Strings that do not match (examples)'), lines: no },
  ];
  // (The panel's box runs the pattern again as JavaScript, on text `PY_SHOWN` allows (`python`), and shows the groups' texts: none
  // where JavaScript's are not Python's.)
  const box = groupFacts(call.regex.source).agree ? interactive({ kind: 'regex', regex: js, mode: 'values', python: true }, [{ label: testStringsLabel(lang), lines: [...yes, ...no] }], lang) : undefined;
  return { kind: 'regex', title, sections: sections.filter((x) => x.lines.length), ...(box ? { interactive: box } : {}) };
}
