import * as assert from 'assert';
import * as path from 'path';
import { Analyzer } from '../src/analyzer';
import type { Example, ExplainOptions } from '../src/analyzer-types';
import { explainDocumentLine } from '../src/document';
import { openDocument } from '../src/document-setup';
import { NO_PYTHON_FLAGS, type PythonRegexOptions } from '../src/embedded/regex-python';
import { pyRepr } from '../src/examples/python-calls';
import { toJsRegex } from '../src/examples/regex';
import { extractShell } from '../src/hosts';
import { PYTHON_REFERENCE } from '../src/python-reference';
import { createUnbashParser } from '../src/syntax/adapters/unbash';
import { needPython, pythonReference } from './support/python';
import { run } from './support/run';

// The examples of the calls of Python's `re` (docs/design/python-regex.md, sections 6 and 7) against the reference Python, in one
// process (test/support/python-calls.py): where a call gets an example, what it shows is what Python gives. A call with strings that
// match and do not has each checked with the call; one with an input and a result has the call run on that input (made up, or the
// call's literal) and the `repr` of what it gives back compared. `REFUSED` has the calls that get no example, with the reason.

const parser = createUnbashParser();

/** The examples of the line of `call` in a `.py` file that imports `re`. */
function examplesOf(call: string, lang: 'en' | 'ja' = 'en', opts: ExplainOptions = {}): Example[] {
  const doc = openDocument(`import re\n${call}\n`, 'python', (t) => parser.parse(t));
  return explainDocumentLine(new Analyzer(lang), doc, 1, lang, {}, opts).examples;
}

/** A row: a call as a `.py` file writes it (`s` is the subject where it is not a literal), and the release it needs, if not all. */
type Row = string | [call: string, since: string];

const EXAMPLES: Row[] = [
  // Strings that match and do not, with each function's anchors and the flags.
  String.raw`re.search(r'\d+', s)`, String.raw`re.match(r'[a-z]+\d', s)`, [String.raw`re.prefixmatch(r'ab', s)`, '3.15'],
  String.raw`re.fullmatch(r'\d{3}-\d{4}', s)`, String.raw`re.compile(r'^\w+@\w+\.com$')`, String.raw`re.search(r'^a.c$', s, re.M)`,
  String.raw`re.search(r'colou?r', s, re.I)`, String.raw`re.fullmatch(r'(?x) \d+ # digits', s)`, String.raw`re.search(r'a{1, 3}', s, re.X)`,
  String.raw`re.search(r'x{,2}y', s)`, String.raw`re.search(r'x{,}y', s)`, String.raw`re.search(r'x{}', s)`, String.raw`re.search(r'[]a]', s)`,
  String.raw`re.search(r'[^]a]b', s)`, String.raw`re.search(r'[a-]', s)`, String.raw`re.search(r'[\d-]x', s)`, String.raw`re.search(r'[[:alpha:]]', s)`,
  String.raw`re.search(r'(?P<w>\w)(?P=w)', s)`, String.raw`re.search(r'(\w)\1', s)`, String.raw`re.search(r'(?<=a)b(?!c)', s)`,
  "re.search(r'\\x41\\101\\" + "u0042', s)",String.raw`re.search(rb'\d+', s)`, String.raw`re.search(r'(?s:a.b)', s)`, String.raw`re.search(r'(?i)ab', s)`,
  String.raw`re.search(r'(?#comment)ab*?', s)`, String.raw`re.match(r'\Aab\Z', s)`, String.raw`re.search(r'\bfoo\b', s)`, String.raw`re.search(r'a|b|', s)`,
  String.raw`re.search(r'[\b\t-]x[\x41-\x43]', s)`, String.raw`re.compile(r'(?m)a$', re.I)`, String.raw`re.search(r'\.\-', s, flags=re.A)`,
  // A literal subject: what the call gives back.
  String.raw`re.search(r'\d+', 'abc 123')`, String.raw`re.search(r'x', 'abc')`, String.raw`re.match(r'b', 'ab')`, String.raw`re.fullmatch(r'a|ab', 'ab')`,
  String.raw`re.search('a$', 'a\n')`, String.raw`re.search(r'a\Z', 'a\n')`, String.raw`re.search(r'a.b', 'a\nb')`, String.raw`re.search(r'a.b', 'a\nb', re.S)`,
  String.raw`re.search(r'^b', 'a\nb', re.M)`, `re.search(r'a+', 'b${'a'.repeat(80)}')`, String.raw`re.search(r"'", "it's")`, String.raw`re.search(r'"', 'say "hi"')`,
  String.raw`re.search(r'..', '\'"')`, String.raw`re.search(rb'a', b'xa')`, String.raw`re.match(r'a', string='ba')`,
  // findall: strings, one group's text, tuples; empty matches.
  String.raw`re.findall(r'\d+', 'a1b22c333')`, String.raw`re.findall(r'(\w+)=(\d+)', 'a=1, b=22')`, String.raw`re.findall(r'(\w+)=\d+', 'a=1, b=22')`,
  String.raw`re.findall(r'(a)|b', 'ab')`, String.raw`re.findall(r'x*', 'axxb')`, String.raw`re.findall(r'|a', 'a')`, String.raw`re.findall(r'(?m)^', 'a\nb\n')`,
  String.raw`re.findall(r'\b', 'ab cd')`, String.raw`re.findall(r'a+?', 'aaa')`, String.raw`re.findall(r'(a)+', 'aaa ba')`, String.raw`re.findall(rb'\d+', b'a1b22')`,
  String.raw`re.findall(r'(\w+)=(\d+)', s)`, [String.raw`re.findall(r'\B', '')`, '3.14'], [String.raw`re.findall(r'a\z', 'a')`, '3.14'],
  String.raw`re.findall(r'(a)(b)?', 'ab a')`,
  // split: the pieces, each group's text between them, None for one that did not take part.
  String.raw`re.split(r',\s*', 'a, b,c')`, String.raw`re.split(r'(,)|(;)', 'a,b;c')`, String.raw`re.split(r'x*', 'axbc')`, String.raw`re.split(r'\s+', s)`,
  String.raw`re.split(r',', 'a,b,c', 1)`, String.raw`re.split(r',', 'a,b,c', maxsplit=1)`, String.raw`re.split(r'(-)', 'a-b-c')`, String.raw`re.split(r'$', 'a\nb\n', flags=re.M)`,
  String.raw`re.split(r'^\s*', '  ab')`,
  // sub and subn: a replacement without a backslash; count, and a flag in its slot.
  String.raw`re.sub(r'\s+', ' ', 'a  b\tc')`, String.raw`re.sub('x*', '-', 'abxd')`, String.raw`re.sub('|a', '-', 'a')`, String.raw`re.sub(r'a', 'b', 'aaa', 2)`,
  String.raw`re.sub(r'a', 'b', 'aaa', count=1)`, String.raw`re.sub(r'a', 'b', 'aAa', re.I)`, String.raw`re.sub(r'(?i)a', 'b', 'aAa')`, String.raw`re.sub(r'\d', '#', s)`,
  String.raw`re.sub(r'$', '!', 'a\nb\n')`, String.raw`re.sub(r'^', '> ', 'a\nb', flags=re.M)`, String.raw`re.subn(r'o', '0', 'foo boo')`, String.raw`re.subn(rb'o', b'0', b'foo')`,
  String.raw`re.sub(r'(?:a*)*b', 'X', 'aab')`, String.raw`re.sub(r'(a|)+', 'X', 'aab')`, String.raw`re.sub(r'(?x) a \  b', '_', 'a b')`, String.raw`re.sub(r'a', 'b', 'aaa', 0)`,
  String.raw`re.sub(r'^\s+', '', s)`, String.raw`re.sub(r'\s+$', '', s)`, String.raw`re.subn(r'\d+', 'N', s)`,
  // Made-up texts where every text matches, or the words around the matches match too; a set with escapes.
  String.raw`re.search(r'[Z-a]', s, re.I)`, String.raw`re.findall(r'[^a-z]', 'aBc_1', re.I)`, String.raw`re.split(r'a', 'xAxaxaxax', re.I)`,
  String.raw`re.search(r'a*', s)`, String.raw`re.findall(r'x*', s)`, String.raw`re.findall(r'(?:\b(a))+', 'a aa')`, String.raw`re.search(r'[\]\-]x', s)`,
];

/** Calls that get no example, each for its reason. */
const REFUSED: [call: string, why: string][] = [
  [String.raw`re.search(r'(?>a)b', s)`, 'an atomic group'], [String.raw`re.search(r'a++', s)`, 'a possessive quantifier'],
  [String.raw`re.search(r'(a)?(?(1)b|c)', s)`, 'a conditional'], [String.raw`re.search(r'\N{EM DASH}', s)`, 'a character by its name'],
  [String.raw`re.search(r'(a)?\1', s)`, 'a reference to a group that may not take part'], [String.raw`re.search(r'(a)|b\1', s)`, 'the same, in another branch'],
  [String.raw`re.search(r'(?P<n>a)*(?P=n)', s)`, 'the same, by name'],
  [String.raw`re.search('a', s, flags)`, 'flags not known'], [String.raw`re.search('a', s, re.I | extra)`, 'flags partly not known'],
  [String.raw`re.search(rb'\w', s, re.L)`, 'the locale'], [String.raw`re.search(rb'(?L)\w', s)`, 'the locale, inline'],
  [String.raw`re.finditer(r'a', 'a')`, 'an iterator'], [String.raw`re.sub(r'(a)', r'\1', 'a')`, 'a template (#752)'],
  [String.raw`re.sub(r'a', lambda m: 'b', 'a')`, 'a function as the replacement'], [String.raw`re.sub(r'a', r, 'a')`, 'a replacement not known'],
  [String.raw`re.sub(r'a', 'b')`, 'no subject (TypeError)'], [String.raw`re.search(r'a')`, 'no subject (TypeError)'],
  [String.raw`re.search(r'a', 'é')`, 'a subject past ASCII'], [String.raw`re.search(r'a', 'a\r')`, 'a carriage return'],
  ["re.search(r'a', 'a\\" + "u2028')", 'a line separator'], [String.raw`re.search(r'a', 'a\x1f')`, 'a control character'],
  [String.raw`re.sub(r'a', 'é', 'a')`, 'a replacement past ASCII'], [String.raw`re.search(rb'a', 'a')`, 'a str subject for a bytes pattern'],
  [String.raw`re.sub(rb'a', 'b', b'a')`, 'a str replacement for a bytes pattern'],
  [String.raw`re.search(r'(?i:a)b', s)`, 'a case flag of a group'], [String.raw`re.search(r'(?-i:a)b', s, re.I)`, 'the same, turned off'],
  [String.raw`re.search(r'(?i)é', s)`, 'case folding past ASCII'], ["re.search(r'[\\" + "u0100-\\" + "uffff]', s, re.I)", 'the same, in a range'],
  [String.raw`re.sub(r'a', 'b', 'aaa', n)`, 'a count not known'], [String.raw`re.sub(r'a', 'b', 'aaa', -1)`, 'a count not written as a number'],
  [String.raw`re.findall(r'(?:(a)|b)+', 'ab')`, 'a group cleared by a repetition in JavaScript'], [String.raw`re.findall(r'(a*)*', 'b')`, 'a group in a repetition that may be empty'],
  [String.raw`re.split(r'(?:x(a)?)+', 'xax')`, 'the same, an optional group'], [String.raw`re.findall(r'(?:(?=(a)))+', 'a')`, 'a group in a lookaround that repeats'],
  [String.raw`re.search(r'*a', s)`, 'a pattern Python refuses'], [String.raw`re.compile(r'a(?#unclosed')`, 'the same'],
  ["re.search(r'" + String.fromCodePoint(0x1f600) + "?x', s)", 'a character past U+FFFF'],
  [String.raw`re.search(rb'(?L:a)', s)`, 'the locale, in a group'], [String.raw`re.search(r'[\N{EM DASH}]', s)`, 'a character by its name, in a set'],
  [String.raw`re.sub(r'a')`, 'no replacement (TypeError)'], [String.raw`re.sub('é', 'x', s)`, 'no ASCII text it matches in'],
  [String.raw`re.search('é', s)`, 'the same'], [String.raw`re.search(r'a{2}+', s)`, 'a possessive count'],
];

describe('Python regex: the examples of the calls of `re`', () => {
  it('gives no example for what JavaScript cannot say as Python does', () => {
    assert.deepStrictEqual(REFUSED.filter(([call]) => examplesOf(call).length).map(([call, why]) => `${call} (${why})`), []);
    // (Each is a call the file reads: the example is what is left out, not the pattern.)
    assert.deepStrictEqual(REFUSED.filter(([call]) => extractShell('python', `import re\n${call}\n`).languages.length !== 1).map(([call]) => call), []);
  });

  it('gives an example for each call of the rows that compare with Python', () => {
    assert.deepStrictEqual(EXAMPLES.map((r) => (typeof r === 'string' ? r : r[0])).filter((call) => examplesOf(call).length !== 1), []);
  });

  it('shows the subject and what the call gives back, each labelled, under the pattern', () => {
    const [ex] = examplesOf(String.raw`re.sub(r'\s+', ' ', 'a  b\tc')`);
    assert.deepStrictEqual([ex.kind, ex.title, ex.anchor, ex.sections], ['regex', 'Example', { start: { line: 1, character: 7 }, end: { line: 1, character: 13 } }, [
      { label: 'Input: the argument `string`', lines: [String.raw`'a  b\tc'`] }, { label: 'Result (what `re.sub` returns)', lines: ["'a b c'"] }]]);
    assert.deepStrictEqual(examplesOf(String.raw`re.split(r',\s*', s)`, 'ja')[0].sections.map((s) => s.label), ['入力: 引数 `string`（仮の文字列）', '結果（`re.split` の戻り値）']);
    const [values] = examplesOf(String.raw`re.fullmatch(r'\d{3}-\d{4}', s)`, 'ja');
    assert.deepStrictEqual([values.title, values.sections.map((s) => s.label), values.interactive?.spec], ['例（`re.fullmatch` は文字列全体と照合する）', ['一致する文字列（例）', '一致しない文字列（例）'],
      { kind: 'regex', mode: 'values', regex: { source: String.raw`(?<![\s\S])(?:\d{3}\-\d{4})(?![\s\S])`, flags: '' } }]);
  });

  it('follows the settings: no example with examples off, or with the kind `regex` off', () => {
    const call = String.raw`re.search(r'\d+', s)`;
    assert.strictEqual(examplesOf(call, 'en', { examples: { enabled: false, disabled: [] } }).length, 0);
    assert.strictEqual(examplesOf(call, 'en', { examples: { enabled: true, disabled: ['regex'] } }).length, 0);
    assert.strictEqual(examplesOf(call, 'en', { examples: { enabled: true, disabled: ['sed'] } }).length, 1);
  });

  it('says an example is not computed where its run would cost too much, and shows no result', () => {
    const [ex] = examplesOf(`re.search(r'(a+)+$', '${'a'.repeat(40)}!')`);
    assert.deepStrictEqual(ex.sections, []);
    assert.match(ex.note!, /Not computed: this pattern may take too long on this text/);
  });
});

describe('Python regex: a pattern as JavaScript, and a value as Python prints it', () => {
  const js = (p: string, py: Partial<PythonRegexOptions> = {}) => toJsRegex(p, 'python', { python: { ...NO_PYTHON_FLAGS, ...py } });

  it('writes the anchors and `.` out, by the flags, with no JavaScript `m` or `s`', () => {
    assert.deepStrictEqual(js('^a.$'), { source: String.raw`(?<![\s\S])a[^\n](?![^\n]|\n[\s\S])`, flags: '' });
    assert.deepStrictEqual(js('^a.$', { multiline: true, dotall: true, ignorecase: true }), { source: String.raw`(?<![^\n])a[\s\S](?![^\n])`, flags: 'i' });
    assert.deepStrictEqual(js(String.raw`\A(?P<x>a)(?P=x)\Z{,2}`), undefined);
    assert.deepStrictEqual(js(String.raw`\A(?P<x>a)(?P=x)b{,2}\z`), { source: String.raw`(?<![\s\S])(a)(?:\1)b{0,2}(?![\s\S])`, flags: '' });
    // (Without the flags of the call, none.)
    assert.strictEqual(toJsRegex('a', 'python'), undefined);
  });

  it('refuses what Python refuses, which the reader says first', () => {
    const refused = ['(?#c', '(?P=x)', '(?i-i:a)', 'a)', '(a', '[a', '[\\', '[\\x4]', '[\\e]', '[a-\\N{X}]', '[\\d-z]', '[z-a]', '[a-', '*a', '{2}', 'a**',
      'a\\', '\\2', '\\e', '\\x4', '(?<n>a)', '^*', '\\b+'];
    assert.deepStrictEqual(refused.filter((p) => js(p) !== undefined), []);
  });

  it("writes a value as Python's `repr` does", () => {
    assert.deepStrictEqual([pyRepr("a'b", false), pyRepr('a\'"b\\', false), pyRepr('\r\x01\x7f\t\n', true), pyRepr(undefined, false)],
      ['"a\'b"', "'a\\'\"b\\\\'", "b'\\r\\x01\\x7f\\t\\n'", 'None']);
  });
});

/** Whether a release is the reference's or later. */
function atLeast(release: string): boolean {
  const [major, minor] = release.split('.').map(Number);
  const [refMajor, refMinor] = PYTHON_REFERENCE.split('.').map(Number);
  return major < refMajor || (major === refMajor && minor <= refMinor);
}

describe('Python regex: the examples of the calls of `re` against the reference Python', function () {
  this.timeout(60000);
  const ref = pythonReference();
  type Asked = { call: string; s: string | null; tests: string[] | null; bytes: boolean; ours: string | boolean[] };
  let asked: Asked[];
  let got: { version: string; results: (string | boolean[])[] };
  before(function () {
    needPython(this, ref);
    asked = EXAMPLES.filter((r) => typeof r === 'string' || atLeast(r[1])).map((r) => {
      const call = typeof r === 'string' ? r : r[0];
      const [ex] = examplesOf(call);
      const bytes = /^re\.\w+\(r?b/.test(call);
      if (ex.interactive) {
        const [yes, no = { lines: [] }] = ex.sections;
        return { call, s: null, tests: [...yes.lines, ...no.lines], bytes, ours: [...yes.lines.map(() => true), ...no.lines.map(() => false)] };
      }
      return { call, s: ex.sections[0].lines[0], tests: null, bytes, ours: ex.sections[1].lines[0] };
    });
    const r = run((ref as { python: string }).python, ['-I', path.join(__dirname, 'support', 'python-calls.py')], { input: JSON.stringify(asked), timeout: 60000 });
    assert.strictEqual(r.status, 0, r.stderr.toString());
    got = JSON.parse(r.stdout.toString()) as typeof got;
    assert.strictEqual(got.version, PYTHON_REFERENCE);
  });

  it('shows what Python gives back, and strings that match where Python finds a match', () => {
    const wrong = asked.flatMap((a, i) => (JSON.stringify(a.ours) === JSON.stringify(got.results[i]) ? [] : [`${a.call}${a.s ? ` with s = ${a.s}` : ''}: Python ${JSON.stringify(got.results[i])}, ours ${JSON.stringify(a.ours)}`]));
    assert.deepStrictEqual(wrong, []);
  });
});
