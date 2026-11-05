import * as assert from 'assert';
import { explainRegex } from '../src/embedded/regex';
import { run } from './support/run';
import { allTokens } from './support/explain';

/** What `grep -oP` prints for `pattern` on `input` (status 2: the pattern is an error). */
function grepP(pattern: string, input: string): { out: string; status: number | null } {
  const r = run('grep', ['-oP', '--', pattern], { input });
  return { out: r.stdout.toString(), status: r.status };
}

/**
 * [pattern, input, what grep -oP prints, the token's text, what its explanation says].
 * The explanation is checked against the real tool: the rows are the claims it makes.
 */
const rows: [string, string, string, string, RegExp][] = [
  ['a=\\K\\S+', 'a=b c\n', 'b\n', '\\K', /keep what has matched so far out of the reported match/],
  ['\\Qa.b\\E', 'axb a.b\n', 'a.b\n', '\\Qa.b\\E', /taken literally/],
  ['a\\Rb', 'a\rb\n', 'a\rb\n', '\\R', /one line break/],
  ['a\\hb', 'a b a\fb\n', 'a b\n', '\\h', /horizontal whitespace/],
  ['a\\Hb', 'a b axb\n', 'axb\n', '\\H', /not horizontal whitespace/],
  ['a\\vb', 'a b a\fb\n', 'a\fb\n', '\\v', /vertical whitespace/],
  ['a\\Vb', 'a b a\fb\n', 'a b\n', '\\V', /not vertical whitespace/],
  ['\\N+', 'abc\n', 'abc\n', '\\N', /any one character except a newline/],
  ['\\G\\d', '12a3\n', '1\n2\n', '\\G', /where the previous match ended/],
  ['\\x41\\x{42}\\103', 'ABC\n', 'ABC\n', '\\x41', /code 0x41 \("A"\)/],
  ['\\x41\\x{42}\\103', 'ABC\n', 'ABC\n', '\\x{42}', /code 0x42 \("B"\)/],
  ['\\x41\\x{42}\\103', 'ABC\n', 'ABC\n', '\\103', /code 0x43 \("C"\)/],
  ['a\\012b', 'a\n', '', '\\012', /code 0x0A$/],
  ['(a)\\101', 'aA\n', 'aA\n', '\\101', /code 0x41 \("A"\)/],
  ['(a)(a)(a)(a)(a)(a)(a)(a)(a)(a)\\10', 'aaaaaaaaaaa\n', 'aaaaaaaaaaa\n', '\\10', /group 10 matched/],
  ['\\cA', '\x01\n', '\x01\n', '\\cA', /control character Ctrl-A/],
  ['\\p{Lu}+', 'aBCd\n', 'BC\n', '\\p{Lu}', /with the Unicode property `Lu`/],
  ['\\P{Lu}+', 'aBCd\n', 'a\nd\n', '\\P{Lu}', /without the Unicode property `Lu`/],
  ['\\X', 'ab\n', 'a\nb\n', '\\X', /grapheme cluster/],
  ['a\\<', 'a< ab\n', 'a<\n', '\\<', /A literal "<"/],
  ['a\\>', 'a> ab\n', 'a>\n', '\\>', /A literal ">"/],
  ['(?<n>a)\\k<n>', 'aa ab\n', 'aa\n', '\\k<n>', /text group n \(1\) matched/],
  ['(?<n>a)\\k{n}', 'aa ab\n', 'aa\n', '\\k{n}', /text group n \(1\) matched/],
  ["(?'n'a)\\k'n'", 'aa ab\n', 'aa\n', "(?'n'a)", /Named group `n` \(group 1\)/],
  ['(a)\\g1', 'aa ab\n', 'aa\n', '\\g1', /text group 1 matched/],
  ['(a)\\g{-1}', 'aa ab\n', 'aa\n', '\\g{-1}', /text group 1 matched/],
  ['(?<n>a)\\g{n}', 'aa ab\n', 'aa\n', '\\g{n}', /text group n \(1\) matched/],
  ['(?>a+)ab', 'aaab\n', '', '(?>a+)', /atomic group/],
  ['(?:a+)ab', 'aaab\n', 'aaab\n', '(?:a+)', /non-capturing/],
  ['(?i:a)b', 'Ab AB\n', 'Ab\n', '(?i:a)', /options inside this group only/],
  ['(?i)ab', 'AB\n', 'AB\n', '(?i)', /set matching options from here/],
  ['(?#x)a', 'a\n', 'a\n', '(?#x)', /a comment/],
  ['(?P<n>a)b', 'ab\n', 'ab\n', '(?P<n>a)', /Named group `n` \(group 1\)/],
  ['a(?=b)', 'ab ac\n', 'a\n', '(?=b)', /lookahead/],
  ['a(?!b)', 'ab ac\n', 'a\n', '(?!b)', /negative lookahead/],
  ['(?<=a)b', 'ab cb\n', 'b\n', '(?<=a)', /lookbehind/],
  ['(?<!a)b', 'ab cb\n', 'b\n', '(?<!a)', /negative lookbehind/],
  ['a.*?b', 'axbxb\n', 'axb\n', '*?', /as few as possible/],
  ['a.*+b', 'axb\n', '', '*+', /possessive/],
  ['a{1,2}+a', 'aa\n', '', '{1,2}+', /possessive/],
  ['a??b', 'ab\n', 'ab\n', '??', /as few as possible/],
  ['\\bfoo\\b', 'foo foobar\n', 'foo\n', '\\b', /word boundary/],
  ['\\Boo', 'foo oo\n', 'oo\n', '\\B', /not a word boundary/],
  ['\\d+', 'a12\n', '12\n', '\\d', /a digit/],
  ['\\D+', 'a12\n', 'a\n', '\\D', /a non-digit/],
  ['\\w+', 'a_1-\n', 'a_1\n', '\\w', /word character/],
  ['\\W', 'a-\n', '-\n', '\\W', /non-word character/],
  ['a\\sb', 'a b\n', 'a b\n', '\\s', /whitespace/],
  ['\\S+', 'ab c\n', 'ab\nc\n', '\\S', /non-whitespace/],
  ['\\Aab', 'abab\n', 'ab\n', '\\A', /start of the subject/],
  ['ab\\z', 'abab\n', 'ab\n', '\\z', /end of the subject/],
  ['ab\\Z', 'abab\n', 'ab\n', '\\Z', /end of the subject/],
  ['\\e', '\x1b\n', '\x1b\n', '\\e', /escape character/],
  ['\\f', '\f\n', '\f\n', '\\f', /form feed/],
  ['\\a', '\x07\n', '\x07\n', '\\a', /bell/],
  ['[\\b]', 'a\bc\n', '\b\n', '[\\b]', /a backspace/],
  ['[\\h]+', 'a  b\n', '  \n', '[\\h]', /horizontal whitespace/],
  ['[\\.\\]]+', 'a.]\n', '.]\n', '[\\.\\]]', /one of ".", "\]"/],
  ['[\\n\\x41]+', 'xAy\n', 'A\n', '[\\n\\x41]', /one of a newline, the character with code 0x41/],
];

describe('PCRE escapes and groups agree with grep -P', () => {
  for (const [pattern, input, out, text, says] of rows) {
    it(`${pattern}: ${text}`, () => {
      const real = grepP(pattern, input);
      assert.strictEqual(real.out, out, `grep -oP printed ${JSON.stringify(real.out)}`);
      assert.notStrictEqual(real.status, 2, 'grep -P took it for an error');
      const t = allTokens(explainRegex(pattern, 'pcre', 'en')).find((x) => pattern.slice(x.start, x.end) === text);
      assert.ok(t, `no token ${text}`);
      assert.match(t.explanation, says);
      assert.notStrictEqual(t.kind, 'error');
      assert.ok(allTokens(explainRegex(pattern, 'pcre', 'ja')).find((x) => pattern.slice(x.start, x.end) === text), 'ja has the token');
    });
  }

  it('says an escape grep -P rejects is an error, and one it cannot read is unread', () => {
    for (const p of ['\\y', '\\i', '[\\K]', '[\\R]']) assert.strictEqual(grepP(p, 'y\n').status, 2, p);
    const bad = explainRegex('\\y', 'pcre', 'en')[0];
    assert.strictEqual(bad.kind, 'error');
    assert.match(bad.explanation, /unrecognized character follows/);
    assert.match(explainRegex('[\\K]', 'pcre', 'en')[0].explanation, /`\\K` \(not valid in a class\)/);
    // Valid for PCRE2, but not read here: never a literal.
    for (const p of ['\\C', '(?1)', '(?R)', '(?|a|b)', '(*UTF)', '(?(1)a|b)', '(?P=n)', '\\g', '\\p']) {
      const [t] = explainRegex(p, 'pcre', 'en');
      assert.match(t.explanation, /does not read/, p);
      assert.strictEqual(t.end, p.length, p);
    }
    assert.match(explainRegex('(?|a', 'pcre', 'ja')[0].explanation, /読めない/);
  });

  it('reads a group that is not closed and a reference to a group that is missing', () => {
    assert.strictEqual(explainRegex('(?R', 'pcre', 'en')[0].end, 3);
    assert.strictEqual(explainRegex('(?1\\)', 'pcre', 'en')[0].end, 5);
    assert.match(explainRegex('\\g1', 'pcre', 'en')[0].explanation, /no such group/);
    assert.match(explainRegex('(a)\\g{-2}', 'pcre', 'en')[1].explanation, /no such group/);
    assert.match(explainRegex('\\k<zz>', 'pcre', 'en')[0].explanation, /group zz matched \(no such group/);
    assert.match(explainRegex('\\Qa.b', 'pcre', 'en')[0].explanation, /"a\.b"/);
    assert.match(explainRegex('\\E', 'pcre', 'en')[0].explanation, /end of a `\\Q`/);
    assert.match(explainRegex('\\x', 'pcre', 'en')[0].explanation, /code 0x00/);
    assert.match(explainRegex('\\0', 'pcre', 'en')[0].explanation, /code 0x00/);
    assert.match(explainRegex('[\\.\\]]', 'pcre', 'en')[0].explanation, /one of ".", "\]"/);
    assert.match(explainRegex('[\\.\\y]', 'pcre', 'ja')[0].explanation, /「\.」、`\\y`（クラスの中では使えない）/);
    assert.match(explainRegex('\\o{101}', 'pcre', 'en')[0].explanation, /code 0x41 \("A"\)/);
    assert.match(explainRegex('\\x7f\\x{110000}', 'pcre', 'en')[0].explanation, /the character with code 0x7F$/);
    assert.match(explainRegex('\\x{110000}', 'pcre', 'en')[0].explanation, /code 0x110000$/);
    assert.match(explainRegex('\\p{^L}', 'pcre', 'en')[0].explanation, /without the Unicode property `L`/);
    assert.match(explainRegex('\\pL', 'pcre', 'en')[0].explanation, /with the Unicode property `L`/);
  });

  it('keeps the other flavors as they were', () => {
    assert.match(explainRegex('\\<a', 'ere', 'en')[0].explanation, /start of a word/);
    assert.match(explainRegex('\\K', 'ere', 'en')[0].explanation, /Literal "K"/);
    assert.match(explainRegex('\\h', 'ere', 'en')[0].explanation, /just "h" in POSIX regex/);
  });
});
