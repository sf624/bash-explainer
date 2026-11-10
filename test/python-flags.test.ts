import * as assert from 'assert';
import * as fs from 'fs';
import * as path from 'path';
import { Analyzer } from '../src/analyzer';
import type { LineExplanation, Token } from '../src/analyzer-types';
import { documentIssues, explainDocumentLine, type ShellDocument } from '../src/document';
import { openDocument } from '../src/document-setup';
import { explainRegex } from '../src/embedded/regex';
import { NO_PYTHON_FLAGS, type PythonRegexOptions } from '../src/embedded/regex-python';
import type { EmbeddedToken } from '../src/embedded/types';
import { extractShell } from '../src/hosts';
import { readSaid } from '../src/messages-tokens';
import { createUnbashParser } from '../src/syntax/adapters/unbash';

// The flags of a Python pattern (docs/design/python-regex.md, 5.2 and 5.3; #749): the flags argument as the extractor reads it,
// the options the reader takes from it and from the pattern's inline flags, VERBOSE patterns, bytes patterns, and the pitfall of a
// flag in the slot of `count`.

const parser = createUnbashParser();
const open = (src: string): ShellDocument => openDocument(src, 'python', (t) => parser.parse(t));
const explainPy = (src: string, line: number, lang: 'ja' | 'en' = 'en', opts = {}): LineExplanation => explainDocumentLine(new Analyzer(lang), open(src), line, lang, {}, opts);
const plain = (t: string) => readSaid(t).text;
const texts = (ts: readonly Token[]): string[] => ts.flatMap((t) => [`${t.label}: ${plain(t.explanation)}`, ...texts(t.children)]);
/** The options of each region of a file. */
const options = (src: string) => extractShell('python', src).languages.map((r) => r.options);
/** The flags each argument of each region gives: the full names, and their value. */
const flagsOf = (src: string) => extractShell('python', src).languages.map((r) => r.args.map((a) => a.flags && [a.flags.names.map((n) => n.flag), a.flags.value]));
const on = (o: Partial<PythonRegexOptions>): PythonRegexOptions => ({ ...NO_PYTHON_FLAGS, ...o });
const unknown = (bytes = false): PythonRegexOptions => ({ ascii: 'unknown', ignorecase: 'unknown', multiline: 'unknown', dotall: 'unknown', verbose: 'unknown', locale: 'unknown', unicode: 'unknown', bytes });

/** The texts of the tokens of a pattern read with `python`. */
function said(pattern: string, python: Partial<PythonRegexOptions> = {}): string[] {
  const out: string[] = [];
  const walk = (t: EmbeddedToken) => {
    out.push(`${pattern.slice(t.start, t.end)}: ${plain(t.explanation)}`);
    t.children.forEach(walk);
  };
  explainRegex(pattern, 'python', 'en', { tool: 'python', python: { ...NO_PYTHON_FLAGS, ...python } }).forEach(walk);
  return out;
}
const kinds = (pattern: string, python: Partial<PythonRegexOptions> = {}) => explainRegex(pattern, 'python', 'en', { tool: 'python', python: { ...NO_PYTHON_FLAGS, ...python } }).map((t) => `${pattern.slice(t.start, t.end)}:${t.kind}`);

describe('Python regex: flags', () => {
  describe('the flags argument, as the extractor reads it', () => {
    it('reads names of `re` joined by `|`, short or long, by keyword or in the slot of `flags`', () => {
      assert.deepStrictEqual(options("import re\nre.search('a', s, re.I | re.M)\n"), [on({ ignorecase: true, multiline: true })]);
      assert.deepStrictEqual(options("import re\nre.compile('a', flags=re.DOTALL|re.VERBOSE|re.ASCII)\n"), [on({ dotall: true, verbose: true, ascii: true })]);
      assert.deepStrictEqual(options("import re\nre.sub('a', 'b', s, 0, (re.IGNORECASE))\n"), [on({ ignorecase: true })]);
      assert.deepStrictEqual(flagsOf("import re\nre.search('a', s, re.I | re.MULTILINE)\n"), [[undefined, undefined, [['IGNORECASE', 'MULTILINE'], 10]]]);
    });

    it('reads `0` and `re.NOFLAG` as no flags, and no flags argument as none', () => {
      for (const call of ["re.search('a', s, 0)", "re.search('a', s, flags=re.NOFLAG)", "re.search('a', s)"]) assert.deepStrictEqual(options(`import re\n${call}\n`), [NO_PYTHON_FLAGS], call);
      assert.deepStrictEqual(flagsOf("import re\nre.search('a', s, 0)\n"), [[undefined, undefined, [['NOFLAG'], 0]]]);
    });

    it('reads the names by the file\'s imports', () => {
      assert.deepStrictEqual(options("import re as regex\nregex.search('a', s, regex.I)\n"), [on({ ignorecase: true })]);
      assert.deepStrictEqual(options("from re import search, I, MULTILINE as ML\nsearch('a', s, I | ML)\n"), [on({ ignorecase: true, multiline: true })]);
      // (A name of another module, or one the file does not import, is not known.)
      assert.deepStrictEqual(options("import re\nimport other\nre.search('a', s, other.I)\n"), [unknown()]);
      assert.deepStrictEqual(options("import re\nre.search('a', s, I)\n"), [unknown()]);
    });

    it('makes every option not known for anything else: a name, an operator other than `|`, a number, a name `re` lacks', () => {
      for (const flags of ['opts', 're.I + re.M', '2', 're.FOO', 'get()', 're.I |', 're.I | x if c else 0', 're.I or re.M', '(re.I | x) == 0']) {
        assert.deepStrictEqual(options(`import re\nre.search('a', s, flags=${flags})\n`), [unknown()], flags);
      }
    });

    it('keeps the names it can read as on where another term is not known, and the rest not known', () => {
      const rest = (o: Partial<PythonRegexOptions>) => ({ ...unknown(), ...o });
      assert.deepStrictEqual(options("import re\nre.compile('a', re.X | extra)\n"), [rest({ verbose: true })]);
      assert.deepStrictEqual(options("import re\nre.compile('a', flags=extra | re.I | (re.M & mask))\n"), [rest({ ignorecase: true })]);
      // (`0` and `re.NOFLAG` are names too: all known.)
      assert.deepStrictEqual(options("import re\nre.compile('a', re.I | 0)\n"), [on({ ignorecase: true })]);
      // (A token for each name, and one for each term not known.)
      assert.deepStrictEqual(texts(explainPy("import re\nre.compile('a', re.X | get(1, 2))\n", 1).items.filter((t) => !t.language)), [
        're.X: `re.X` (`re.VERBOSE`): whitespace in the pattern is ignored, and `#` starts a comment to the end of the line (not in a set or after a backslash)',
        'get(1, 2): The flags `get(1, 2)`: not known here, so a part of the pattern whose meaning depends on them says so']);
    });

    it('takes `bytes` from the pattern\'s literal', () => {
      assert.deepStrictEqual(options("import re\nre.search(rb'a', s)\nre.search(b'a', s, flags=x)\n"), [on({ bytes: true }), unknown(true)]);
    });
  });

  describe('what the tokens of the pattern say under the flags', () => {
    it('says `^` and `$` at each line with `re.MULTILINE`, and that they depend on the flags when those are not known', () => {
      assert.deepStrictEqual(said('^a$', { multiline: true }).filter((t) => /^[$^]:/.test(t)), ['^: `^`: start of the text and of each line (`re.MULTILINE`)', '$: `$`: end of each line and of the text (`re.MULTILINE`)']);
      assert.deepStrictEqual(said('^a$').filter((t) => /^[$^]:/.test(t)), ['^: `^`: start of the text', '$: `$`: end of the text (or before a final newline)']);
      assert.ok(said('^a$', unknown()).filter((t) => /^[$^]:/.test(t)).every((t) => /each line with `re\.MULTILINE`: the flags are not known/.test(t)));
    });

    it('says `.` takes a newline with `re.DOTALL`', () => {
      assert.deepStrictEqual(said('.', { dotall: true }), ['.: `.`: any character, a newline too (`re.DOTALL`)']);
      assert.deepStrictEqual(said('.'), ['.: `.`: any character except a newline']);
      assert.match(said('.', unknown())[0], /a newline too with `re\.DOTALL`: the flags are not known/);
    });

    it('says letters match in either case with `re.IGNORECASE`, in literals and sets', () => {
      assert.deepStrictEqual(said('ab[a-z]1', { ignorecase: true }), ['ab: Literal "ab", in either case', '[a-z]: Character class: one of a-z, in either case', '1: Literal "1"']);
      assert.deepStrictEqual(said('ab[a-z]'), ['ab: Literal "ab"', '[a-z]: Character class: one of a-z']);
      assert.match(said('ab', unknown())[0], /in either case with `re\.IGNORECASE`: the flags are not known/);
      // (A set of escapes only has no letter that case changes.)
      assert.deepStrictEqual(said('[\\d]', { ignorecase: true }), ['[\\d]: Character class: one of a decimal digit of any script (`０`, `١`… too)']);
    });

    it('says `\\w`, `\\d`, `\\s` and `\\b` are ASCII with `re.ASCII` or in a bytes pattern, Unicode otherwise, and by the locale with `re.LOCALE`', () => {
      assert.match(said('\\w')[0], /any script/);
      assert.doesNotMatch(said('\\w')[0], /re\.ASCII/);
      for (const o of [{ ascii: true }, { bytes: true }]) assert.deepStrictEqual(said('\\w\\d\\s\\b', o).map((t) => /ASCII|0-9/.test(t)), [true, true, true, true], JSON.stringify(o));
      assert.match(said('\\w', unknown())[0], /only ASCII characters with `re\.ASCII`: the flags are not known/);
      assert.match(said('\\w', { bytes: true, locale: true })[0], /locale/);
      assert.match(said('\\w', unknown(true))[0], /ASCII word character.*by the current locale with `re\.LOCALE`: the flags are not known/);
      assert.doesNotMatch(said('\\d', unknown(true))[0], /locale/);
      assert.match(said('[\\w]', { ascii: true })[0], /ASCII/);
    });
  });

  describe('inline flags', () => {
    it('sets flags for the whole pattern at its start', () => {
      assert.deepStrictEqual(said('(?i)a'), ['(?i): `(?i)`: flags for the whole pattern: `re.IGNORECASE` (letters match in either case)', 'a: Literal "a", in either case']);
      assert.deepStrictEqual(said('(?m)(?#c)(?s)^.').slice(-2), ['^: `^`: start of the text and of each line (`re.MULTILINE`)', '.: `.`: any character, a newline too (`re.DOTALL`)']);
      // (Over flags not known, the pattern's own are known.)
      assert.deepStrictEqual(said('(?i)a', unknown())[1], 'a: Literal "a", in either case');
    });

    it('sets and clears flags inside a group only', () => {
      assert.deepStrictEqual(said('(?i:a)b'), ['(?i:a): `(?i:…)`: inside this group only (no number): `re.IGNORECASE` (letters match in either case)', 'a: Literal "a", in either case', 'b: Literal "b"']);
      assert.deepStrictEqual(said('(?-i:a)b', { ignorecase: true }), ['(?-i:a): `(?-i:…)`: inside this group only (no number): without `re.IGNORECASE` (case-sensitive)', 'a: Literal "a"', 'b: Literal "b", in either case']);
      // (Each flag turned off says what the group does without it; with flags turned on, after them.)
      assert.deepStrictEqual(said('(?i-msx:a)', { multiline: true, dotall: true, verbose: true })[0], '(?i-msx:a): `(?i-msx:…)`: inside this group only (no number): `re.IGNORECASE` (letters match in either case); '
        + 'without `re.MULTILINE` (`^` and `$` match at the start and end of the text only, not of each line), without `re.DOTALL` (`.` does not match a newline), without `re.VERBOSE` (whitespace and `#` match as characters)');
      const ja = (p: string) => explainRegex(p, 'python', 'ja', { tool: 'python', python: { ...NO_PYTHON_FLAGS, ignorecase: true } }).map((t) => plain(t.explanation))[0];
      assert.strictEqual(ja('(?-i:a)'), '`(?-i:…)`: このグループの中だけ（番号は付かない）: `re.IGNORECASE` を外す（大文字小文字を区別する）');
    });

    it('refuses global flags not at the start, as an error since Python 3.11', () => {
      for (const p of ['a(?i)b', 'a|(?i)b', '((?i)a)']) {
        const err = explainRegex(p, 'python', 'en', { tool: 'python', python: NO_PYTHON_FLAGS }).flatMap(function all(t): EmbeddedToken[] { return [t, ...t.children.flatMap(all)]; }).find((t) => t.kind === 'error');
        assert.match(plain(err!.explanation), /global flags not at the start of the expression at position \d+.*Python 3\.11/, p);
      }
    });
  });

  describe('VERBOSE', () => {
    it('reads whitespace as ignored and `#` as a comment, not in a set or after a backslash', () => {
      assert.deepStrictEqual(kinds('a b  # c\n[ #]\\ \\#', { verbose: true }), ['a:string', ' :comment', 'b:string', '# c:comment', '[ #]:pattern', '\\ :string', '\\#:string']);
      assert.deepStrictEqual(said('a b', { verbose: true })[1], ' : Whitespace: ignored (`re.VERBOSE`)');
      // (Indentation, and the whitespace before a comment or a line's end, get no token.)
      assert.deepStrictEqual(kinds('\n  a  \n  b', { verbose: true }), ['a:string', 'b:string']);
    });

    it('repeats the item before the whitespace, and refuses a lazy `?` after it', () => {
      assert.deepStrictEqual(said('ab *', { verbose: true }), ['a: Literal "a"', 'b: Literal "b"', ' : Whitespace: ignored (`re.VERBOSE`)', '*: `*`: repeat `b` zero or more times']);
      assert.match(said('a* ?', { verbose: true }).at(-1)!, /multiple repeat at position 3/);
      // (A message of a pattern with a newline gives its line and column, as Python's.)
      assert.match(said('#c\n*', { verbose: true }).at(-1)!, /"nothing to repeat at position 3 \(line 2, column 1\)"/);
      assert.match(said('*\na')[0], /"nothing to repeat at position 0 \(line 1, column 1\)"/);
      // (`{1, 3}` is no count: the literal text `a{1,3}`.)
      assert.deepStrictEqual(kinds('a{1, 3}', { verbose: true }), ['a{1,:string', ' :comment', '3}:string']);
    });

    it('turns VERBOSE on and off by inline flags, and says a space or `#` depends on the flags when they are not known', () => {
      assert.deepStrictEqual(kinds('(?x) a b'), ['(?x):keyword', ' :comment', 'a:string', ' :comment', 'b:string']);
      assert.deepStrictEqual(kinds('(?-x:a b)c d', { verbose: true }).length, 4);
      assert.match(said('a b', unknown())[0], /ignored with `re\.VERBOSE`: the flags are not known/);
    });

    it('says no Error where VERBOSE is not known and only the reading without it refuses the pattern', () => {
      const issues = (src: string) => documentIssues(open(src), 'en', {}, [], {}).map((i) => [i.code, i.severity]);
      // (Python compiles it with `re.X`: the `(?i)` after whitespace and the `[` in a comment are no errors there.)
      const src = "import re\nFLAGS = re.X | re.I\nP = re.compile(r'''\n  (?i) a  # see [1\n''', FLAGS)\n";
      assert.deepStrictEqual(issues(src), []);
      const all = texts(explainPy(src, 2).items);
      assert.ok(all.some((t) => t.includes('Without `re.VERBOSE`, Python\'s `re` refuses this pattern ("global flags not at the start of the expression at position 3')), all.join('\n'));
      // (A comment with an unbalanced `(`.)
      assert.deepStrictEqual(issues("import re\nre.compile('a # (', flags)\n"), []);
      // (Refused both ways alike: an Error still.)
      assert.deepStrictEqual(issues("import re\nre.compile('[a # c', flags)\n").map(([, s]) => s), ['error']);
      // (With `re.X` named beside a term not known, VERBOSE is on: nothing is refused.)
      assert.deepStrictEqual(texts(explainPy("import re\nre.compile(r'(?i) a # (', re.X | extra)\n", 1).items).filter((t) => /refuses/.test(t)), []);
    });

    it('labels whitespace it ignores as the outputs show a blank: `␣`', () => {
      const ex = explainPy("import re\nre.compile(r'a b  c\td', re.X)\n", 1);
      assert.deepStrictEqual(ex.items[0].children.filter((t) => t.kind === 'comment').map((t) => t.label), ['␣', '␣␣', '⇥']);
    });

    it('explains each line of a VERBOSE pattern over several lines, the comments as comment rows', () => {
      const src = 'import re\nDATE = re.compile(r"""\\d+  # the year\n  -(\\d\\d)  # the month""", re.X)\n';
      const ex = explainPy(src, 2);
      const all = texts(ex.items);
      assert.ok(all.includes('# the year: A comment to the end of the line (`re.VERBOSE`): ignored'), all.join('\n'));
      assert.ok(all.includes('# the month: A comment to the end of the line (`re.VERBOSE`): ignored'));
      assert.ok(all.some((t) => t.startsWith('re.X: `re.X` (`re.VERBOSE`)')));
      assert.deepStrictEqual(explainPy(src, 1).items.length, ex.items.length);
    });
  });

  describe('bytes patterns', () => {
    it('refuses `\\u`, `\\U` and `\\N`, which only str patterns have', () => {
      for (const [p, message] of [['\\u0041', 'bad escape \\u at position 0'], ['\\U00000041', 'bad escape \\U at position 0'], ['\\N{EM DASH}', 'bad escape \\N at position 0'], ['[\\u0041]', 'bad escape \\u at position 1']]) {
        assert.ok(said(p, { bytes: true }).some((t) => t.includes(message)), p);
      }
      assert.ok(!said('\\x41', { bytes: true }).some((t) => t.includes('bad escape')));
    });

    it('refuses `(?L)` in a str pattern and `(?u)` in a bytes one', () => {
      assert.match(said('(?L)a')[0], /cannot use 'L' flag with a str pattern at position 3/);
      assert.match(said('(?u)a', { bytes: true })[0], /cannot use 'u' flag with a bytes pattern at position 3/);
      assert.doesNotMatch(said('(?L)a', { bytes: true })[0], /cannot/);
    });
  });

  describe('the tokens of the flags argument', () => {
    it('gives each name a token with the flag\'s meaning, and one token to flags not known', () => {
      const tokens = (src: string) => texts(explainPy(src, 1).items.filter((t) => !t.language));
      assert.deepStrictEqual(tokens("import re\nre.search('a', s, re.I | re.MULTILINE)\n"), [
        're.I: `re.I` (`re.IGNORECASE`): letters match in either case', 're.MULTILINE: `^` and `$` match at the start and end of each line too']);
      assert.deepStrictEqual(tokens("import re\nre.search('a', s, flags=0)\n"), ['0: no flags']);
      assert.deepStrictEqual(tokens("import re\nre.search('a', s, flags=opts)\n"), ['opts: The flags `opts`: not known here, so a part of the pattern whose meaning depends on them says so']);
      // (A name written as the long one says no second name; in Japanese too.)
      assert.deepStrictEqual(tokens("from re import search, IGNORECASE\nsearch('a', s, IGNORECASE)\n"), ['IGNORECASE: letters match in either case']);
      assert.deepStrictEqual(texts(explainPy("import re\nre.search('a', s, re.I | re.DOTALL)\n", 1, 'ja').items.filter((t) => !t.language)), [
        're.I: `re.I`（`re.IGNORECASE`）: 大文字小文字を区別しない', 're.DOTALL: `.` が改行にも一致する']);
      // (In the order of the text: a keyword argument may come first.)
      assert.deepStrictEqual(explainPy("import re\nre.search(flags=re.I, pattern='a', string=s)\n", 1).items.map((t) => t.label), ['re.I', "'a'"]);
    });
  });

  describe('a flag in the slot of `count` or `maxsplit`', () => {
    const issues = (src: string, opts = {}) => documentIssues(open(src), 'en', {}, [], opts).map((i) => [i.code, i.severity, i.startLine, i.startCol, i.endCol]);

    it('is a Warning at the argument: it is `count`, and the positional form is deprecated since Python 3.13', () => {
      const src = "import re\nre.sub('a', 'b', s, re.I)\n";
      assert.deepStrictEqual(issues(src), [['python-regex-flag-as-count', 'warning', 1, 20, 24]]);
      const note = explainPy(src, 1).noteInfo.find((n) => n.code === 'python-regex-flag-as-count')!;
      assert.match(note.text, /`re\.I` is passed as `count` \(2\)/);
      assert.match(note.text, /Python 3\.13/);
      assert.deepStrictEqual(issues("import re\nre.split(',', s, re.M | re.I)\n"), [['python-regex-flag-as-count', 'warning', 1, 17, 28]]);
      assert.match(explainPy("import re\nre.split(',', s, re.M)\n", 1).noteInfo[0].text, /`maxsplit` \(8\)/);
      assert.ok(texts(explainPy(src, 1).items).includes('re.I: `re.I` here is the argument `count` (the value 2), not a flag'));
    });

    it('is said whatever the pattern is: a call whose pattern is not literals gets the tokens of its arguments only', () => {
      for (const call of ["re.sub(pat, '', s, re.I)", "re.sub(r'a' + x, '', s, re.I)", "re.split(SEP, s, re.M)"]) {
        assert.deepStrictEqual(issues(`import re\n${call}\n`).map(([c]) => c), ['python-regex-flag-as-count'], call);
      }
      const ex = explainPy("import re\nre.sub(pat, '', s, re.I)\n", 1);
      assert.deepStrictEqual(texts(ex.items), ['re.I: `re.I` here is the argument `count` (the value 2), not a flag']);
      assert.strictEqual(explainPy("import re\nre.sub(pat, '', s, re.I)\n", 1, 'en', { reading: true }).reading, undefined);
      // (No such fact, no region: the pattern is not read.)
      assert.deepStrictEqual(extractShell('python', "import re\nre.sub(pat, '', s)\nre.sub(pat, '', s, re.I | x)\nre.search(pat, s, re.I)\n").languages, []);
      // (On a line of another call's pattern, it has the line too: #813.)
      assert.deepStrictEqual(extractShell('python', "import re\nre.sub(r'a', 'b', re.sub(pat, '', s, re.I))\n").languages.map((r) => r.lines), [[1], [1]]);
      // (A line of a shell region is none of its lines.)
      assert.deepStrictEqual(extractShell('python', "import re, os\nos.system('ls') or re.sub(pat, '', s, re.I)\n").languages, []);
    });

    it('is said for flags passed by keyword too, without the deprecation of the slot', () => {
      for (const [call, param] of [["re.sub('a', 'b', s, count=re.I)", 'count'], ["re.split(',', s, maxsplit=re.M)", 'maxsplit']]) {
        assert.deepStrictEqual(issues(`import re\n${call}\n`).map(([c]) => c), ['python-regex-flag-as-count'], call);
        const note = explainPy(`import re\n${call}\n`, 1).noteInfo[0].text;
        assert.match(note, new RegExp(`is passed as \`${param}\``));
        assert.doesNotMatch(note, /DeprecationWarning/);
      }
    });

    it('is none for a count, flags in their slot or by keyword, or a flag that is 0', () => {
      for (const call of ["re.sub('a', 'b', s, 1)", "re.sub('a', 'b', s, 0, re.I)", "re.sub('a', 'b', s, count=1, flags=re.I)", "re.sub('a', 'b', s, re.NOFLAG)", "re.subn('a', 'b', s, x)", "re.sub('a', 'b', s, count=0)"]) {
        assert.deepStrictEqual(issues(`import re\n${call}\n`), [], call);
      }
    });

    it('is left out with the pitfalls off', () => {
      assert.deepStrictEqual(issues("import re\nre.sub('a', 'b', s, re.I)\n", { pitfalls: false }), []);
    });
  });

  it('has one table of the flags (docs/design/sources.md, row 35): no other file of src/ names a flag as a string or a key', () => {
    const files = (dir: string): string[] => fs.readdirSync(dir, { withFileTypes: true }).flatMap((e) => (e.isDirectory() ? files(path.join(dir, e.name)) : e.name.endsWith('.ts') ? [path.join(dir, e.name)] : []));
    const src = path.join(__dirname, '..', 'src');
    const naming = /['"](?:ASCII|IGNORECASE|LOCALE|MULTILINE|DOTALL|VERBOSE|UNICODE|NOFLAG)['"]|^\s*(?:IGNORECASE|MULTILINE|DOTALL|VERBOSE|NOFLAG):/m;
    assert.deepStrictEqual(files(src).filter((f) => naming.test(fs.readFileSync(f, 'utf8'))).map((f) => path.relative(src, f)).sort(), ['embedded/regex-python.ts', 'messages-tokens-regex.ts']);
  });
});

describe('Python regex: flags Python refuses with ValueError (#760)', () => {
  const issues = (src: string) => documentIssues(open(src), 'en', {}, [], {}).map((i) => [i.code, i.severity, i.startLine, i.startCol, i.endCol]);

  it('says an Error on the flag of the argument that makes it, with Python\'s message, and gives no example', () => {
    const ex = explainPy("import re\nre.findall(r'a', 'a', re.A | re.U)\n", 1);
    assert.deepStrictEqual(texts(ex.items).filter((t) => t.includes('ValueError')), [
      're.U: `re.U` (`re.UNICODE`): Unicode matching, which a str pattern has already. Python\'s `re` refuses these flags ("ASCII and UNICODE flags are incompatible"; `ValueError`)']);
    assert.deepStrictEqual(ex.examples, []);
    assert.ok(texts(explainPy("import re\nre.compile('a', re.L)\n", 1, 'ja').items).some((t) => t.includes('。Python の `re` はこのフラグを受け付けない（"cannot use LOCALE flag with a str pattern"。`ValueError`）')));
    assert.deepStrictEqual(issues("import re\nre.compile('a', re.L)\n").map((i) => i.slice(1)), [['error', 1, 16, 20]]);
    assert.deepStrictEqual(issues("import re\nre.compile(rb'a', re.I | re.UNICODE)\n").map((i) => i.slice(1)), [['error', 1, 25, 35]]);
    // (Flags not known, or a str pattern with `re.A` alone, are none; `re.L` with bytes is one.)
    assert.deepStrictEqual(issues("import re\nre.compile('a', re.A | flags)\nre.compile('a', re.A)\nre.compile(rb'a', re.L)\n"), []);
  });

  it('says it at the inline flags where they make it, as Python does once it has read the pattern', () => {
    const said = (p: string, python: Partial<PythonRegexOptions> = {}) => explainRegex(p, 'python', 'en', { tool: 'python', python: { ...NO_PYTHON_FLAGS, ...python } }).filter((t) => t.kind === 'error').map((t) => p.slice(t.start, t.end));
    assert.deepStrictEqual(said('(?a)(?u)a'), ['(?u)']);
    assert.deepStrictEqual(said('(?u)a', { ascii: true }), ['(?u)']);
    assert.deepStrictEqual(said('(?L)a', { ascii: true, bytes: true }), ['(?L)']);
    // (The argument says its own; a group's own flags go with any; a refusal of the parser comes first.)
    assert.deepStrictEqual(said('(?a)a', { locale: true }), []);
    assert.deepStrictEqual(said('(?u:x)', { ascii: true }), []);
    assert.deepStrictEqual(said('(?a)(?u)\\e'), ['\\e']);
  });
});
