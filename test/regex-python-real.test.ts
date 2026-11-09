import * as assert from 'assert';
import * as fs from 'fs';
import * as os from 'os';
import * as path from 'path';
import { spawnSync } from 'child_process';
import { explainRegex } from '../src/embedded/regex';
import type { EmbeddedToken } from '../src/embedded/types';
import { PYTHON_REFERENCE } from '../src/hosts/pylex';
import { readSaid } from '../src/messages-tokens';
import { needPython, pythonReference } from './support/python';

// The patterns the regex reader's flavor `python` refuses (docs/design/python-regex.md, section 3), against the reference
// Python's `re.compile`, in one process (test/support/python-re.py): each row has Python's message, or none, and so does the
// reader. The rows are those this flavor reads: the escapes, references to groups, and what is left open. Python's other
// refusals (a lookbehind of variable width, global flags not at the start…) come with #760.

const VALID = [
  '^\\d+(?P<frac>\\.\\d+)?$', '\\Z', '\\z', '\\A\\b\\B', '[\\b]', '\\v[\\v]', '\\0', '\\012', '\\141', '[\\101]', '[\\0]', '(a)\\1', '(a)(b)\\2', '\\x41',
  '\\u00e9', '\\U0001F600', '\\N{EM DASH}', '[\\N{EM DASH}]', '[\\x41-\\x5a]', '[\\u0041-\\u005a]', '\\-\\_\\%\\é', '(?i)a', '(?s).', '(?>a)', 'a++', 'a{,2}',
  '(?#c)a', '[[:alpha:]]', '\\\\', '(?P<n>a)', '[\\d\\s\\w]', '\\w+@\\w+\\.\\w+', '[^\\]]', '(a)(b)(c)(d)(e)(f)(g)(h)(i)(j)\\10', '\\01a',
  '(?P<n>a)(?P=n)', '(a)?(?(1)b|c)', '.', '\\w\\W\\d\\D\\s\\S', 'a*?', 'a*+', 'a{2}?', '(?:)*', '(?=a)*', '(?<=a)+', 'a(?#c)*', '[a]*', '(a)+', 'a{3,3}',
  'a{2,}', 'a{,}', 'a{2,1', '\\*.txt', '[*].txt', 'a|b*', '(?i)a*',
];

const REFUSED = [
  '\\e', '[\\e]', '\\h', '\\G', '\\K', '\\Q', '\\E', '\\L', '\\R', '\\X', '\\c', '\\p{L}', '\\o{1}', '\\g<1>', '\\k<n>', '[\\Z]', '[\\A]', '[\\B]',
  '\\x{41}', '\\x4', '\\u00e', '\\U0010FFF', '\\U00110000', '[\\x4]', '\\N', '\\N{', '\\N{}', '\\N{abc', '[\\N]', '\\777', '[\\777]', '[\\8]', '\\8',
  '\\2', '(a)\\3', '(a\\1)', '((a)\\1)', '(a)(b\\2)', '[a', '(a', 'a\\', '[a\\', 'a(b[c]', '(?P<n>a',
  // (A glob taken for a regex, and other quantifiers with nothing to repeat or after another; a `)` that closes nothing.)
  '*.txt', '*', '+a', '?', 'a|*', '(*a)', '(|+)', '^*', '$*', '\\b*', '\\A+', '\\Z?', '(?i)*', '(?#c)*', 'a**', 'a*?*', 'a++*', 'a{2}*', 'a{1,2}{3}',
  '[a]**', '(a)??+', 'x{2,1}', 'ab{3,2}', 'x{3,2}+', '{2,1}', 'a)', '(a))b', 'a|)', ')',
];

/** The messages of Python's refusals that the reader says, in the order of its tokens. */
function refusals(pattern: string): string[] {
  const out: string[] = [];
  const walk = (t: EmbeddedToken) => {
    const said = readSaid(t.explanation);
    if (t.kind === 'error' && said.said.some((s) => s.id === 'regex-python-error')) out.push(/\("(.*)"\)$/s.exec(said.text)![1]);
    t.children.forEach(walk);
  };
  explainRegex(pattern, 'python', 'en', { tool: 'python' }).forEach(walk);
  return out;
}

/**
 * What `.` and the classes of one letter match in a str pattern, and what the reader says of them: a search, what Python finds (or
 * null), and the words a text of the pattern's tokens has. `.` leaves out a newline; the classes are Unicode.
 */
const SEARCHES: [pattern: string, text: string, found: string | null, said: RegExp][] = [
  ['a.b', 'a\nb', null, /except a newline/], ['a.b', 'a\tb', 'a\tb', /except a newline/],
  ['\\w+', '日本語 abc', '日本語', /any script/], ['\\W', '日', null, /any script/], ['[\\w]+', 'é1_', 'é1_', /any script/],
  ['\\d+', '０١3', '０١3', /any script/], ['\\D', '١', null, /any script/],
  ['\\s', '\u3000', '\u3000', /Unicode whitespace/], ['\\S', '\u3000', null, /Unicode whitespace/],
  ['\\b日', 'x 日', '日', /any script/], ['x\\B日', 'x日', 'x日', /any script/],
];

/** The texts of a pattern's tokens. */
function texts(pattern: string): string[] {
  const out: string[] = [];
  const walk = (t: EmbeddedToken) => {
    out.push(readSaid(t.explanation).text);
    t.children.forEach(walk);
  };
  explainRegex(pattern, 'python', 'en', { tool: 'python' }).forEach(walk);
  return out;
}

describe('the Python flavor of the regex reader against the reference Python', function () {
  this.timeout(60000);
  const ref = pythonReference();
  let got: { version: string; errors: (string | null)[]; found: (string | null)[] };
  before(function () {
    needPython(this, ref);
    const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'explain-bash-python-re-'));
    try {
      const request = path.join(dir, 'request.json');
      fs.writeFileSync(request, JSON.stringify({ patterns: [...VALID, ...REFUSED], searches: SEARCHES.map(([p, t]) => [p, t]) }));
      const r = spawnSync((ref as { python: string }).python, ['-I', path.join(__dirname, 'support', 'python-re.py'), request], { encoding: 'utf8', timeout: 60000 });
      assert.strictEqual(r.status, 0, r.stderr);
      got = JSON.parse(r.stdout) as typeof got;
    } finally {
      fs.rmSync(dir, { recursive: true, force: true });
    }
    assert.strictEqual(got.version, PYTHON_REFERENCE);
  });

  it('refuses a pattern where Python does, with its message, and no other', () => {
    const patterns = [...VALID, ...REFUSED];
    const wrong = patterns.flatMap((p, i) => {
      const ours = refusals(p);
      const theirs = got.errors[i];
      const same = theirs === null ? !ours.length : ours[0] === theirs;
      return same ? [] : [`${JSON.stringify(p)}: Python ${JSON.stringify(theirs)}, ours ${JSON.stringify(ours)}`];
    });
    assert.deepStrictEqual(wrong, []);
    // (Each row is where the table says: the valid ones compile.)
    assert.deepStrictEqual(patterns.filter((p, i) => (got.errors[i] === null) !== VALID.includes(p)), []);
  });

  it('says what `.` and the classes match as Python does: not a newline, and letters, digits and spaces of any script', () => {
    assert.deepStrictEqual(got.found, SEARCHES.map(([, , found]) => found));
    assert.deepStrictEqual(SEARCHES.filter(([p, , , said]) => !texts(p).some((t) => said.test(t))).map(([p]) => p), []);
  });
});

describe('the Python flavor of the regex reader: its refusals', () => {
  it('refuses each row the reference refuses, and none of the others', () => {
    assert.deepStrictEqual(VALID.filter((p) => refusals(p).length), []);
    assert.deepStrictEqual(REFUSED.filter((p) => !refusals(p).length), []);
  });

  it('says Python\'s message, with the position in the pattern', () => {
    const first = (p: string) => refusals(p)[0];
    assert.deepStrictEqual(['\\e', '[\\e]', '\\x4', '\\U00110000', '\\N', '\\N{', '\\N{abc', '\\777', '\\2', '(a\\1)', '[a', '(a', 'a\\', '[a\\'].map(first), [
      'bad escape \\e at position 0', 'bad escape \\e at position 1', 'incomplete escape \\x4 at position 0', 'bad escape \\U00110000 at position 0',
      'missing { at position 2', 'missing character name at position 3', 'missing }, unterminated name at position 3',
      'octal escape value \\777 outside of range 0-0o377 at position 0', 'invalid group reference 2 at position 1', 'cannot refer to an open group at position 2',
      'unterminated character set at position 0', 'missing ), unterminated subpattern at position 0', 'bad escape (end of pattern) at position 1',
      'bad escape (end of pattern) at position 2',
    ]);
    assert.deepStrictEqual(['*.txt', '(*a)', '^*', '(?i)*', '(?#c)*', 'a**', 'a*?*', 'x{2,1}', 'ab{3,2}', '{2,1}', 'a)', '(a))b'].map(first), [
      'nothing to repeat at position 0', 'nothing to repeat at position 1', 'nothing to repeat at position 1', 'nothing to repeat at position 4',
      'nothing to repeat at position 5', 'multiple repeat at position 2', 'multiple repeat at position 3', 'min repeat greater than max repeat at position 2',
      'min repeat greater than max repeat at position 3', 'min repeat greater than max repeat at position 1', 'unbalanced parenthesis at position 1',
      'unbalanced parenthesis at position 3',
    ]);
  });

  it('does not check a name of `\\N{…}`: there is no table of Unicode names (the one listed exception)', () => {
    assert.deepStrictEqual(refusals('\\N{NOT A NAME}'), []);
  });
});
