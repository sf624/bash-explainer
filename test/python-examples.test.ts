import * as assert from 'assert';
import * as path from 'path';
import { Analyzer } from '../src/analyzer';
import type { Example, ExplainOptions } from '../src/analyzer-types';
import { explainDocumentLine } from '../src/document';
import { openDocument } from '../src/document-setup';
import { NO_PYTHON_FLAGS, pythonLetters, type PythonRegexOptions } from '../src/embedded/regex-python';
import { pyRepr } from '../src/embedded/regex-python';
import { pythonCallExample, pythonMatches } from '../src/examples/python-calls';
import { toJsRegex } from '../src/examples/regex';
import { JS_CLASS_LETTERS, JS_LETTERS } from '../src/examples/regex-python';
import { advancingFrom, costOf, guarded, scriptRegex } from '../src/examples/regexguard';
import { rerun } from '../src/examples/rerun';
import { extractShell } from '../src/hosts';
import type { ReReturns } from '../src/hosts/python';
import { PYTHON_REFERENCE } from '../src/python-reference';
import { createUnbashParser } from '../src/syntax/adapters/unbash';
import { needPython, pythonReference } from './support/python';
import { run } from './support/run';

// The examples of the calls of Python's `re` (docs/design/python-regex.md, sections 6 and 7) against the reference Python, in one
// process (test/support/python-calls.py): where a call gets an example, what it shows is what Python gives. A call with strings that
// match and do not has each checked with the call; one with an input and a result has the call run on that input (made up, or the
// call's literal) and the `repr` of what it gives back compared. `REFUSED` has the calls that get no example, with the reason.

const parser = createUnbashParser();

/** The examples of the last line of `call` in a `.py` file that imports `re` (the lines before it: a compile its method is linked to). */
function examplesOf(call: string, lang: 'en' | 'ja' = 'en', opts: ExplainOptions = {}): Example[] {
  const doc = openDocument(`import re\n${call}\n`, 'python', (t) => parser.parse(t));
  return explainDocumentLine(new Analyzer(lang), doc, call.split('\n').length, lang, {}, opts).examples;
}

/**
 * A row: a call as a `.py` file writes it (`s` is the subject where it is not a literal), and the release it needs, if not all. A
 * method of a compiled pattern has the statement that compiles it on the line before (`compiled`).
 */
type Row = string | [call: string, since: string];
const compiled = (pattern: string, call: string): string => `P = re.compile(${pattern})\n${call}`;

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
  String.raw`re.sub(r'(?x) a \  b', '_', 'a b')`, String.raw`re.sub(r'a', 'b', 'aaa', 0)`,
  String.raw`re.sub(r'^\s+', '', s)`, String.raw`re.sub(r'\s+$', '', s)`, String.raw`re.subn(r'\d+', 'N', s)`,
  // Made-up texts where every text matches, or the words around the matches match too; a set with escapes.
  String.raw`re.search(r'[Z-a]', s, re.I)`, String.raw`re.findall(r'[^a-z]', 'aBc_1', re.I)`, String.raw`re.split(r'a', 'xAxaxaxax', re.I)`,
  String.raw`re.search(r'a*', s)`, String.raw`re.findall(r'x*', s)`, String.raw`re.findall(r'(?:\b(a))+', 'a aa')`, String.raw`re.search(r'[\]\-]x', s)`,
  // Lookbehinds of one width; repeats whose iterations match something; a group repeated in each repetition; a long text of empty matches.
  String.raw`re.findall(r'(?<=a|b)x', 'axbxcx')`, String.raw`re.search(r'(a)(?<=\1)b', s)`, String.raw`re.search(r'(?<=\ba)b', s)`, String.raw`re.sub(r'(?<!\b)x', '-', 'xax x')`,
  String.raw`re.search(r'(\w)\1+', s)`, String.raw`re.findall(r'(?:x(a)+)+', 'xaxa')`, String.raw`re.findall(r'(?:(a)b)+', 'abab ab')`, String.raw`re.split(r'(a+){2}x', 'baaaxc')`,
  `re.findall(r'x*', '${'a'.repeat(3000)}')`, `re.sub(r'|x', '-', '${'x'.repeat(2000)}')`,
  // Templates: groups by number and by name, the whole match, a group that did not take part, escapes, octal, two digits.
  String.raw`re.sub(r'(\w+)@(\w+)', r'\2 at \1', 'me@host, you@there')`, String.raw`re.sub(r'(?P<w>\w+)', r'<\g<w>>', 'ab cd')`,
  String.raw`re.sub(r'a(b)?', r'[\1|\g<0>]', 'ab a')`, String.raw`re.sub(r'(a)', r'\n\t\\\101\-\%', 'xa')`, String.raw`re.subn(r'(\d)', r'\1\1', 'a1b2')`,
  String.raw`re.sub(r'(a)(b)(c)(d)(e)(f)(g)(h)(i)(j)', r'\10\g<10>\g<01>', 'abcdefghij')`, String.raw`re.sub(r'x', r'\g<0>\g<0>', s)`,
  String.raw`re.sub(rb'(a)', rb'<\1>', b'xa')`, String.raw`re.sub('(a)', '\\1\\1', 'a')`, String.raw`re.sub(r'(?P<x>a)|b', r'(\g<x>)', 'ab', 1)`,
  String.raw`re.sub(r'(a)', f'<\\1>', 'a')`,
  // Methods of a compiled pattern: `pos` and `endpos`, by position and by keyword, past the string's end, the flags of the compile.
  compiled(String.raw`r'\d+'`, String.raw`P.search(s)`), compiled(String.raw`r'\d+'`, String.raw`P.search('a1b22', 2)`), compiled(String.raw`r'\d+'`, String.raw`P.match('a1b22', 1)`),
  compiled(String.raw`r'\d+'`, String.raw`P.match('a1b22')`), compiled(String.raw`r'\d+'`, String.raw`P.fullmatch('a1b22', 3, 5)`), compiled(String.raw`r'(\d+)'`, String.raw`P.findall('a1b22c333', 2, 7)`),
  compiled(String.raw`r'^a'`, String.raw`P.search('ba', 1)`), compiled(String.raw`r'(?<=a)b'`, String.raw`P.search('ab', 1)`), compiled(String.raw`r'\bb'`, String.raw`P.search('ab', 1)`),
  compiled(String.raw`r'a$'`, String.raw`P.search('ab', 0, 1)`), compiled(String.raw`r'x*'`, String.raw`P.findall('axxb', pos=1, endpos=3)`), compiled(String.raw`r'a'`, String.raw`P.search('ab', 5)`),
  compiled(String.raw`r''`, String.raw`P.search('ab', 1, 0)`), compiled(String.raw`r'a'`, String.raw`P.findall('aaa', 9)`), compiled(String.raw`r'(\w)(\d)'`, String.raw`P.sub(r'\2\1', 'a1 b2')`),
  compiled(String.raw`r'o', re.I`, String.raw`P.subn('0', 'fOo')`), compiled(String.raw`r','`, String.raw`P.split('a,b,c', 1)`), compiled(String.raw`r'(?P<d>\d)'`, String.raw`P.sub(r'<\g<d>>', s, 1)`),
  compiled(String.raw`r'\w+'`, String.raw`P.fullmatch(s)`), compiled(String.raw`r'b'`, String.raw`P.match('ab', pos=1)`),
  compiled(String.raw`r'a'`, String.raw`P.findall('aaa', 2, 1)`), String.raw`re.sub(r'(?:(a)|b)+', 'x', 'ab')`,
  [compiled(String.raw`r'ab'`, String.raw`P.prefixmatch(s)`), '3.15'],
  // A made-up subject whose groups match different texts, so that a template that reorders them shows it.
  String.raw`re.sub(r'(\w+) (\w+)', r'\2 \1', s)`, String.raw`re.sub(r'(\d)-(\d)-(\d)', r'\3/\2/\1', s)`, String.raw`re.sub(r'(?P<y>\d{4})-(?P<m>\d\d)', r'\g<m>/\g<y>', s)`,
  String.raw`re.findall(r'(a|b)(c|d)', s)`, String.raw`re.sub(r'(a)(\1)', r'\2\1', s)`, String.raw`re.findall(r'(?:a|b)(c)', s)`,
];

/**
 * Lines of two calls (#813): the line, whose last line has both, and each call as Python runs it for its example (`s` where the line
 * gives it what it does not know: a call in its arguments). Each gets its example, in the order written.
 */
const TWO: [line: string, calls: [string, string]][] = [
  [String.raw`x = re.sub(r'a+', '-', re.sub(r'\d', 'a', s))`, [String.raw`re.sub(r'a+', '-', s)`, String.raw`re.sub(r'\d', 'a', s)`]],
  [String.raw`ok = re.findall(r'\d+', 'a1b22') or re.split(r',', 'a,b,c', 1)`, [String.raw`re.findall(r'\d+', 'a1b22')`, String.raw`re.split(r',', 'a,b,c', 1)`]],
  [String.raw`ok = re.match(r'[a-z]+', s) and re.fullmatch(r'\d{2}', s)`, [String.raw`re.match(r'[a-z]+', s)`, String.raw`re.fullmatch(r'\d{2}', s)`]],
  [String.raw`A = re.compile(r'a\d'); B = re.compile(r'(b)c', re.I)`, [String.raw`re.compile(r'a\d')`, String.raw`re.compile(r'(b)c', re.I)`]],
  [compiled(String.raw`r'\d+'`, String.raw`Q = re.compile(r'o')` + '\n' + String.raw`P.findall('a1b22') or Q.sub('0', 'foo')`),
    [compiled(String.raw`r'\d+'`, String.raw`P.findall('a1b22')`), String.raw`Q = re.compile(r'o')` + '\n' + String.raw`Q.sub('0', 'foo')`]],
  [String.raw`y = re.sub(r'(\w)(\w)', r'\2\1',` + '\n' + String.raw`  'abcd') or re.search(r'x$', s)`, [String.raw`re.sub(r'(\w)(\w)', r'\2\1', 'abcd')`, String.raw`re.search(r'x$', s)`]],
];

/** Calls that get no example, each for its reason. */
const REFUSED: [call: string, why: string][] = [
  [String.raw`re.search(r'(?>a)b', s)`, 'an atomic group'], [String.raw`re.search(r'a++', s)`, 'a possessive quantifier'],
  [String.raw`re.search(r'(a)?(?(1)b|c)', s)`, 'a conditional'], [String.raw`re.search(r'\N{EM DASH}', s)`, 'a character by its name'],
  [String.raw`re.search(r'(a)?\1', s)`, 'a reference to a group that may not take part'], [String.raw`re.search(r'(a)|b\1', s)`, 'the same, in another branch'],
  [String.raw`re.search(r'(?P<n>a)*(?P=n)', s)`, 'the same, by name'],
  [String.raw`re.search('a', s, flags)`, 'flags not known'], [String.raw`re.search('a', s, re.I | extra)`, 'flags partly not known'],
  [String.raw`re.search(rb'\w', s, re.L)`, 'the locale'], [String.raw`re.search(rb'(?L)\w', s)`, 'the locale, inline'],
  [String.raw`re.finditer(r'a', 'a')`, 'an iterator'], [String.raw`re.sub(r'(a)', r'\2', 'a')`, 'a template Python refuses'],
  [String.raw`re.sub(r'(?P<n>a)', r'\g<m>', 'a')`, 'the same, a name the pattern lacks (IndexError)'], [String.raw`re.sub(r'(a)', r'\q', 'a')`, 'the same, a bad escape'],
  [String.raw`re.sub(r'(a)', f'{x}\\1', 'a')`, 'a field in the template'], [String.raw`re.sub(r'(?:(a)|b)+', r'\1', 'ab')`, 'a group JavaScript clears in a repetition, in the template'],
  [String.raw`re.sub(r'(a)', '\0', 'a')`, 'a control character from the template'],
  [compiled(String.raw`r'\d+'`, String.raw`P.search(s, 1)`), 'a method with `pos` and a subject not known'], [compiled(String.raw`r'\d+'`, String.raw`P.search('a1', n)`), '`pos` not a number'],
  [compiled(String.raw`r'\d+'`, String.raw`P.finditer('a1')`), 'an iterator, from a method'], [compiled(String.raw`r'\d+'`, String.raw`P.sub(lambda m: 'x', 'a1')`), 'a function as the replacement, of a method'],
  [compiled(String.raw`r'\d+', flags`, String.raw`P.search(s)`), 'the compile\'s flags not known'],
  [String.raw`re.sub(r'a', lambda m: 'b', 'a')`, 'a function as the replacement'], [String.raw`re.sub(r'a', r, 'a')`, 'a replacement not known'],
  [String.raw`re.sub(r'a', 'b')`, 'no subject (TypeError)'], [String.raw`re.search(r'a')`, 'no subject (TypeError)'],
  [String.raw`re.search(r'a', 'é')`, 'a subject past ASCII'], [String.raw`re.search(r'a', 'a\r')`, 'a carriage return'],
  ["re.search(r'a', 'a\\" + "u2028')", 'a line separator'], [String.raw`re.search(r'a', 'a\x1f')`, 'a control character'],
  [String.raw`re.sub(r'a', 'é', 'a')`, 'a replacement past ASCII'], [String.raw`re.search(rb'a', 'a')`, 'a str subject for a bytes pattern'],
  [String.raw`re.sub(rb'a', 'b', b'a')`, 'a str replacement for a bytes pattern'],
  [String.raw`re.search(r'(?i:a)b', s)`, 'a case flag of a group'], [String.raw`re.search(r'(?-i:a)b', s, re.I)`, 'the same, turned off'],
  [String.raw`re.search(r'(?i)é', s)`, 'case folding past ASCII'], ["re.search(r'[\\" + "u0100-\\" + "uffff]', s, re.I)", 'the same, in a range'],
  [String.raw`re.sub(r'a', 'b', 'aaa', n)`, 'a count not known'], [String.raw`re.sub(r'a', 'b', 'aaa', -1)`, 'a count not written as a number'],
  [String.raw`re.findall(r'(?:(a)|b)+', 'ab')`, 'a group cleared by a repetition in JavaScript'], [String.raw`re.findall(r'(a*){2}', 'b')`, 'a group in a repetition that may be empty'],
  [String.raw`re.split(r'(?:x(a)?)+', 'xax')`, 'the same, an optional group'], [String.raw`re.findall(r'(?:(?=(a))a)+', 'a')`, 'a group in a lookaround that repeats'],
  [String.raw`re.findall(r'(?:x(a)*)+', 'xaxx')`, 'the same, a group repeated in a repetition, which may not run in one'], [String.raw`re.split(r'(?:x(a)*)+', 'bxaxxb')`, 'the same'],
  [String.raw`re.findall(r'(?:x(a){0,3})+', 'xaxx')`, 'the same, a count from 0'],
  // (A repetition past its least count that may match nothing: Python takes it, JavaScript fails it.)
  [String.raw`re.split(r'(\s*)?,', 'a, b')`, 'an optional group that may be empty'], [String.raw`re.search(r'(?:|-)?', '-')`, 'the same, no group'],
  [String.raw`re.match(r'(?:x*|y)+', 'y')`, 'the same, repeated'], [String.raw`re.sub('(?: ??){1,}', 'X', ' 1b')`, 'the same, lazy'],
  [String.raw`re.sub(r'(?:a*)*b', 'X', 'aab')`, 'the same'], [String.raw`re.sub(r'(a|)+', 'X', 'aab')`, 'the same, with a group'],
  [String.raw`re.search(r'(a?)(?:\1)+', s)`, 'the same, a reference to a group that may be empty'],
  // (A lookbehind of more than one width, which Python refuses; a reference in one to a group opened in it.)
  [String.raw`re.findall(r'(?<=^|\s)\w+', 'ab cd')`, 'a lookbehind of more than one width'], [String.raw`re.search(r'(?<=\$|USD)\d+', s)`, 'the same'],
  [String.raw`re.search(r'(?<=a|bc)x', s)`, 'the same'], [String.raw`re.search(r'(?<!a|bc)x', s)`, 'the same, negative'], [String.raw`re.search(r'(?<=a+)x', s)`, 'the same, a repeat'],
  [String.raw`re.search(r'(?<=\w*)x', s)`, 'the same'], [String.raw`re.search(r'(?<=a{1,2})x', s)`, 'the same'], [String.raw`re.search(r'(?<=a?)x', s)`, 'the same'],
  [String.raw`re.search(r'(?<=(a|bc))x', s)`, 'the same, in a group'], [String.raw`re.search(r'(a+)(?<=\1)x', s)`, 'the same, a reference'],
  [String.raw`re.search(r'(?<=(a)\1)x', s)`, 'a reference to a group opened in the lookbehind'],
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
    assert.deepStrictEqual(REFUSED.filter(([call]) => extractShell('python', `import re\n${call}\n`).languages.length !== call.split('\n').length).map(([call]) => call), []);
  });

  it('gives an example for each call of the rows that compare with Python', () => {
    assert.deepStrictEqual(EXAMPLES.map((r) => (typeof r === 'string' ? r : r[0])).filter((call) => examplesOf(call).length !== 1), []);
    // (A line of two calls: one for each, its title naming the call.)
    assert.deepStrictEqual(TWO.filter(([line]) => examplesOf(line).filter((e) => e.title.startsWith('Example for `')).length !== 2).map(([line]) => line), []);
  });

  it('shows the subject and what the call gives back, each labelled, under the pattern', () => {
    const [ex] = examplesOf(String.raw`re.sub(r'\s+', ' ', 'a  b\tc')`);
    assert.deepStrictEqual([ex.kind, ex.title, ex.anchor, ex.sections], ['regex', 'Example', { start: { line: 1, character: 7 }, end: { line: 1, character: 13 } }, [
      { label: 'Input: the argument `string`', lines: [String.raw`'a  b\tc'`] }, { label: 'Result (what `re.sub` returns)', lines: ["'a b c'"] }]]);
    assert.deepStrictEqual(examplesOf(String.raw`re.split(r',\s*', s)`, 'ja')[0].sections.map((s) => s.label), ['入力: 引数 `string`（仮の文字列）', '結果（`re.split` の戻り値）']);
    const [values] = examplesOf(String.raw`re.fullmatch(r'\d{3}-\d{4}', s)`, 'ja');
    assert.deepStrictEqual([values.title, values.sections.map((s) => s.label), values.interactive?.spec], ['例（`re.fullmatch` は文字列全体と照合する）', ['一致する文字列（例）', '一致しない文字列（例）'],
      { kind: 'regex', mode: 'values', python: true, regex: { source: String.raw`(?<![\s\S])(?:\d{3}\-\d{4})(?![\s\S])`, flags: '' } }]);
  });

  it('makes up a subject whose groups match different texts where the pattern allows it, so that a template that reorders them shows it', () => {
    const shown = (call: string) => examplesOf(call)[0].sections.map((x) => x.lines[0]);
    assert.deepStrictEqual(shown(String.raw`re.sub(r'(\w+) (\w+)', r'\2 \1', s)`), ["'b cde xyz'", "'cde b xyz'"]);
    assert.deepStrictEqual(shown(String.raw`re.sub(r'(\d)-(\d)-(\d)', r'\3/\2/\1', s)`), ["'abc2-3-4def3-4-5xyz'", "'abc4/3/2def5/4/3xyz'"]);
    // (A back-reference matches what its group did.)
    assert.deepStrictEqual(shown(String.raw`re.sub(r'(a+)-\1', r'<\1>', s)`), ["'abca-adefaaa-aaaxyz'", "'abc<a>def<aaa>xyz'"]);
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

  it('charges what a call gives back before it is made: a long replacement many times over is not computed', () => {
    const [ex] = examplesOf(`re.sub(r'a', '${'R'.repeat(10000)}', '${'a'.repeat(10000)}')`);
    assert.deepStrictEqual(ex.sections, []);
    assert.match(ex.note!, /Not computed: the values this makes may get too large/);
    // (And so do the items of `findall` and the pieces of `split`: each costs what the call that only searches costs, and its `repr`.)
    const text = { value: 'a'.repeat(10000), bytes: false };
    const cost = (returns: ReReturns, source: string) => costOf(() => pythonCallExample({ written: 're.x', returns, regex: { source, flags: '' }, bytes: false, subject: text, count: 0 }, 'en'));
    assert.ok(cost('list', 'a+') > cost('match', 'a+') + 2 * 10000);
    assert.ok(cost('pieces', 'b') > cost('match', 'b') + 2 * 10000);
  });

  it('runs the box of the panel again only on the text its examples may show, and offers none where a group is not what Python says', () => {
    const [ex] = examplesOf(String.raw`re.search(r'\d+', s)`);
    const box = (lines: string[]) => rerun(ex.interactive!.spec, [lines], 'en').sections.map((s) => s.lines);
    assert.deepStrictEqual(box(['tel 123']), [['tel 123']]);
    const not = "Not computed: Python's `re` reads characters past ASCII, and control characters, by its own rules (`\\d` matches `１` too). This example tries ASCII text only";
    assert.deepStrictEqual([box(['tel １２３']), box(['café']), box(['a\x1f1'])], [[[not]], [[not]], [[not]]]);
    assert.strictEqual(examplesOf(String.raw`re.search(r'(?:(a)|b)+', s)`)[0].interactive, undefined);
    assert.ok(examplesOf(String.raw`re.search(r'(a)b', s)`)[0].interactive);
  });
});

describe('Python regex: the matches one after another, as `sre` finds them', () => {
  it('finds a match at a place that does not end there in JavaScript\'s order, as the pattern with a lookbehind of the place does', () => {
    const patterns = ['x*', 'a??', '|a', '(?:|ab|a)', 'a*?b?', '(?=a)|a', '\\b|a', '(a)|', '(?:a|)(?:b|)', '[ab]*?'];
    const texts = ['', 'a', 'ab', 'xab', 'aab b'];
    const wrong: string[] = [];
    for (const p of patterns) {
      for (const t of texts) {
        for (let at = 0; at <= t.length; at++) {
          const theirs = new RegExp(`(?:${p})(?<!^[\\s\\S]{${at}})`, 'y');
          theirs.lastIndex = at;
          const want = theirs.exec(t);
          const got = guarded(() => advancingFrom(scriptRegex(p, 'g'), t, at), () => null);
          if (JSON.stringify(got && [...got, got.index]) !== JSON.stringify(want && [...want, want.index])) wrong.push(`${p} on ${JSON.stringify(t)} at ${at}`);
        }
      }
    }
    assert.deepStrictEqual(wrong, []);
  });

  it('runs in steps that grow with the text, not its square: empty matches all along a text', () => {
    const run = (n: number) => costOf(() => pythonMatches({ source: 'x*', flags: '' }, 'a'.repeat(n)));
    assert.ok(run(4000) < 3 * run(2000), `${run(2000)} then ${run(4000)}`);
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

  it("writes each of Python's escapes of one letter (`pythonLetters`) but those of a character's code, and no other", () => {
    const of = (letters: string) => [...letters].filter((c) => !'xuUN'.includes(c)).sort().join('');
    assert.deepStrictEqual([of(pythonLetters(false).out), of(pythonLetters(false).inClass)], [Object.keys(JS_LETTERS).sort().join(''), Object.keys(JS_CLASS_LETTERS).sort().join('')]);
  });

  it('refuses a repeat past its least count of what can match an empty string, and none of what cannot', () => {
    assert.deepStrictEqual(['(\\s*)?,', '(?:|-)?', '(?:x*|y)+', '(?: ??){1,}', '(a|)+', '(?:a*)*b', '(a?)\\1+', '(?=a)*', '(?:\\b)?'].filter((p) => js(p) !== undefined), []);
    assert.deepStrictEqual(['(\\s+)?,', '(?:a|-)?', '(a)\\1+', '(a*){2}', '(?:(?=a)a)+', 'x*', '(?:ab*)+'].filter((p) => js(p) === undefined), []);
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
    // (Each row's example, and each example of a line of two calls with the call alone.)
    const rows: [string, Example][] = [
      ...EXAMPLES.filter((r) => typeof r === 'string' || atLeast(r[1])).map((r): [string, Example] => [typeof r === 'string' ? r : r[0], examplesOf(typeof r === 'string' ? r : r[0])[0]]),
      ...TWO.flatMap(([line, calls]) => examplesOf(line).map((ex, i): [string, Example] => [calls[i], ex])),
    ];
    asked = rows.map(([call, ex]) => {
      const bytes = /re\.\w+\(r?b/.test(call);
      if (ex.sections[0].label === 'Strings that match (examples)') {
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
