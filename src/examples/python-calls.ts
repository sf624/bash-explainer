// The worked examples of a call of Python's `re` (docs/design/python-regex.md, section 6): what `search`, `match`, `fullmatch`
// and `compile` match, and what `sub`, `subn`, `split` and `findall` give back, as Python prints it (`repr`). The pattern comes as
// JavaScript (`toJsRegex`, src/examples/regex-python.ts) and runs on the guarded engine (`scriptRegex`), in the order Python finds
// its matches: after an empty match, the next one must not be empty where it starts (`pythonMatches`). A subject or a replacement
// written as a literal is used as it is, else the text is made up and its label says so. Only ASCII without control characters
// but tab and newline is shown, where JavaScript and Python read the classes and the case alike.
import type { Example, ExampleSection } from '../analyzer-types';
import { pick } from '../embedded/types';
import type { ReReturns } from '../hosts/python';
import type { Lang } from '../i18n';
import { interactive } from './commands';
import { type JsRegex, regexExamples } from './regex';
import { groupFacts, PY_END, PY_START } from './regex-python';
import { scriptRegex } from './regexguard';
import { testStringsLabel } from './rerun';
import { argumentLabel } from './source';
import { pushAll } from '../lists';

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
  /** The argument `string` and `repl`: a literal's text, `unknown` for another value, none where the call has none. */
  subject?: PyText | 'unknown';
  repl?: PyText | 'unknown';
  /** `count` of `sub` and `subn`, or `maxsplit` of `split`: 0 where it is not given, `unknown` where it is not a number written. */
  count: number | 'unknown';
}

/** What an example may show: ASCII without a control character but a tab or a newline. */
const SHOWN = /^[\t\n\x20-\x7e]*$/;
const shownLine = (t: string): boolean => SHOWN.test(t) && !t.includes('\n');

/** A str or bytes value as Python's `repr` writes it. */
export function pyRepr(value: string | undefined, bytes: boolean): string {
  if (value === undefined) return 'None';
  const q = value.includes("'") && !value.includes('"') ? '"' : "'";
  let out = '';
  for (const ch of value) {
    const code = ch.charCodeAt(0);
    if (ch === '\\' || ch === q) out += `\\${ch}`;
    else if (ch === '\t') out += '\\t';
    else if (ch === '\n') out += '\\n';
    else if (ch === '\r') out += '\\r';
    else if (code < 0x20 || code === 0x7f) out += `\\x${code.toString(16).padStart(2, '0')}`;
    else out += ch;
  }
  return `${bytes ? 'b' : ''}${q}${out}${q}`;
}

/** A match as Python prints it: `<re.Match object; span=(4, 7), match='123'>`, the match's `repr` cut at 50 characters. */
const matchRepr = (m: RegExpExecArray, bytes: boolean): string => `<re.Match object; span=(${m.index}, ${m.index + m[0].length}), match=${pyRepr(m[0], bytes).slice(0, 50)}>`;

/**
 * The matches of `js` in `text` one after another, as `findall`, `split` and `sub` of Python find them (`limit`: at most that many,
 * 0 for all): from where the last one ended, and after an empty one, a match at that place must not be empty (`must_advance` of its
 * `sre`): one that is not is tried there first, then the search goes on one character further.
 */
export function pythonMatches(js: JsRegex, text: string, limit = 0): RegExpExecArray[] {
  const all = scriptRegex(js.source, js.flags + 'g');
  const out: RegExpExecArray[] = [];
  let at = 0;
  let empty = false;
  while (at <= text.length && (!limit || out.length < limit)) {
    let m: RegExpExecArray | null = null;
    if (empty) {
      // (A match at `at` that does not end there.)
      const here = scriptRegex(`(?:${js.source})(?<!^[\\s\\S]{${at}})`, js.flags + 'y');
      here.lastIndex = at;
      m = here.exec(text);
      if (!m && at < text.length) {
        all.lastIndex = at + 1;
        m = all.exec(text);
      }
    } else {
      all.lastIndex = at;
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
  const ex = regexExamples(js, 3, shownLine);
  if (!ex) return undefined;
  const [a, b = a] = ex.matching;
  const tries = [['abc', a, 'def', b, 'xyz'], [a, 'xyz'], ['abc', a]].flatMap((parts) => [parts.join(''), parts.join(' ')]);
  const inserted = (t: string) => (t.startsWith('abc') && t.includes('def') ? [a, b] : [a]);
  return tries.find((t) => {
    const found = pythonMatches(js, t).map((m) => m[0]);
    return found.length === inserted(t).length && found.every((f, k) => f === inserted(t)[k]);
  }) ?? tries[0];
}

/** What a call gives back for the subject `text`, as Python prints it; none where JavaScript's groups would not say Python's. */
function result(call: PythonCall, text: string): string | undefined {
  const { bytes, regex } = call;
  const repr = (v: string | undefined) => pyRepr(v, bytes);
  const groups = groupFacts(regex.source);
  if (call.returns === 'match') {
    const m = scriptRegex(anchored(regex, call.anchors).source, regex.flags).exec(text);
    return m ? matchRepr(m, bytes) : 'None';
  }
  const count = call.count as number;
  if (call.returns === 'list') {
    if (groups.count && !groups.agree) return undefined;
    // (No group: the matches; one: its text; more: a tuple of them. A group that did not take part is an empty string.)
    const items = pythonMatches(regex, text).map((m) => (groups.count === 0 ? repr(m[0]) : groups.count === 1 ? repr(m[1] ?? '') : `(${m.slice(1).map((g) => repr(g ?? '')).join(', ')})`));
    return `[${items.join(', ')}]`;
  }
  if (call.returns === 'pieces') {
    if (groups.count && !groups.agree) return undefined;
    // (Each group's text between the pieces, `None` for one that did not take part.)
    const items: string[] = [];
    let last = 0;
    for (const m of pythonMatches(regex, text, count)) {
      items.push(repr(text.slice(last, m.index)));
      pushAll(items, m.slice(1).map((g) => repr(g)));
      last = m.index + m[0].length;
    }
    items.push(repr(text.slice(last)));
    return `[${items.join(', ')}]`;
  }
  const repl = (call.repl as PyText).value;
  const ms = pythonMatches(regex, text, count);
  let out = '';
  let last = 0;
  for (const m of ms) {
    out += text.slice(last, m.index) + repl;
    last = m.index + m[0].length;
  }
  out += text.slice(last);
  return call.returns === 'replaced' ? repr(out) : `(${repr(out)}, ${ms.length})`;
}

/**
 * The example of a call of `re` (docs/design/python-regex.md, section 6), or none: for `search`, `match`, `fullmatch` and `compile`,
 * strings that match and do not (with the function's anchors), or where the subject is a literal, what the call gives back for it;
 * for `findall`, `split`, `sub` and `subn`, the subject and what the call gives back. None for `finditer`, a replacement with a
 * backslash (a template) or not a literal, a count not written as a number, a subject or a replacement whose type is not the
 * pattern's (Python raises `TypeError`) or that holds what an example does not show.
 */
export function pythonCallExample(call: PythonCall, lang: Lang): Example | undefined {
  if (call.returns === 'iterator' || call.count === 'unknown') return undefined;
  const fits = (t: PyText) => t.bytes === call.bytes && SHOWN.test(t.value);
  if (call.returns === 'replaced' || call.returns === 'counted') {
    const { repl } = call;
    if (!repl || repl === 'unknown' || !fits(repl) || repl.value.includes('\\')) return undefined;
  }
  const { subject } = call;
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
  return { kind: 'regex', title, sections: sections.filter((x) => x.lines.length),
    interactive: interactive({ kind: 'regex', regex: js, mode: 'values' }, [{ label: testStringsLabel(lang), lines: [...yes, ...no] }], lang) };
}
