import * as assert from 'assert';
import { execFileSync } from 'child_process';
import { grepWrap, literalRegex, regexExamples, toJsRegex } from '../src/examples/regex';

/** Lines of `input` that the real tool considers matching. */
function realMatches(pattern: string, flavor: 'bre' | 'ere' | 'pcre', input: string[]): string[] {
  const text = input.join('\n') + '\n';
  if (flavor === 'pcre') {
    // PCRE follows Perl's regex syntax, so perl itself is the reference.
    return execFileSync('perl', ['-ne', 'print if /$ENV{RE}/'], { input: text, env: { ...process.env, RE: pattern } })
      .toString().split('\n').filter(Boolean);
  }
  // GNU sed uses the same POSIX regex engine as grep; pick a delimiter that is not in the pattern.
  const delim = ['%', '#', '|', '@', '~'].find((d) => !pattern.includes(d))!;
  const args = ['-n', ...(flavor === 'ere' ? ['-E'] : []), `\\${delim}${pattern}${delim}p`];
  return execFileSync('sed', args, { input: text }).toString().split('\n').filter(Boolean);
}

const cases: [string, 'bre' | 'ere' | 'pcre'][] = [
  ['^[A-Z]{3}-[0-9]+$', 'ere'], ['colou\\?r', 'bre'], ['^ERROR', 'bre'], ['(foo|bar)-\\1', 'ere'], ['\\(ab\\)\\{2\\}', 'bre'],
  ['^v([0-9]+)\\.([0-9]+)$', 'ere'], ['[[:digit:]]\\{4\\}-[[:digit:]]\\{2\\}', 'bre'], ['a+(b)', 'bre'], ['^#', 'bre'],
  ['[^0-9]+', 'ere'], ['^[a-z_][a-z0-9_]*=', 'ere'], ['\\.log$', 'bre'], ['x{2,3}y?', 'ere'], ['[]a]b', 'ere'],
  ['(?<=id=)\\d+', 'pcre'], ['\\bfoo\\b', 'pcre'], ['^\\s*#', 'pcre'], ['(?<year>\\d{4})-\\d\\d', 'pcre'],
];

describe('regex examples agree with real engines', () => {
  for (const [pattern, flavor] of cases) {
    it(`${pattern} (${flavor})`, () => {
      const js = toJsRegex(pattern, flavor);
      assert.ok(js, 'translated');
      const ex = regexExamples(js)!;
      assert.ok(ex && ex.matching.length > 0, 'has matching examples');
      const all = [...ex.matching, ...ex.nonMatching];
      assert.deepStrictEqual(realMatches(pattern, flavor, all), ex.matching, `matches among ${JSON.stringify(all)}`);
    });
  }
});

describe('regex translation', () => {
  it('turns BRE syntax into JavaScript', () => {
    assert.strictEqual(toJsRegex('\\(a\\)\\{2,\\}b+?', 'bre')!.source, '(a){2,}b\\+\\?');
    assert.strictEqual(toJsRegex('*a', 'bre')!.source, '\\*a');
    assert.strictEqual(toJsRegex('[[:upper:]]\\<x\\>', 'bre')!.source, '[A-Z]\\bx\\b');
  });

  it('declines what JavaScript cannot express', () => {
    assert.strictEqual(toJsRegex('a++', 'pcre'), undefined);
    assert.strictEqual(toJsRegex('(?>a)', 'pcre'), undefined);
    assert.strictEqual(toJsRegex('[[=a=]]', 'ere'), undefined);
  });

  it('applies grep -F, -x and -w', () => {
    assert.ok(new RegExp(literalRegex('a.b', false).source).test('a.b'));
    assert.ok(!new RegExp(literalRegex('a.b', false).source).test('axb'));
    const x = grepWrap(toJsRegex('ab', 'bre')!, true, false);
    assert.ok(!new RegExp(x.source).test('abc'));
    const w = grepWrap(toJsRegex('ab', 'bre')!, false, true);
    assert.ok(new RegExp(w.source).test('x ab y') && !new RegExp(w.source).test('xab'));
  });
});
