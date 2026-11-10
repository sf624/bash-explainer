import * as assert from 'assert';
import { run } from './support/run';
import { Analyzer } from '../src/analyzer';
import { grepWrap, literalRegex, regexExamples, toJsRegex } from '../src/examples/regex';
import { createUnbashParser } from '../src/syntax/adapters/unbash';

/** Lines of `input` that the real tool considers matching. */
function realMatches(pattern: string, flavor: 'bre' | 'ere' | 'pcre', input: string[]): string[] {
  const text = input.join('\n') + '\n';
  if (flavor === 'pcre') {
    // PCRE follows Perl's regex syntax, so perl itself is the reference.
    // -l: lines without their newline, as grep -P matches them.
    return run('perl', ['-lne', 'print if /$ENV{RE}/'], { input: text, env: { ...process.env, RE: pattern }, check: true }).stdout
      .toString().split('\n').filter(Boolean);
  }
  // GNU sed uses the same POSIX regex engine as grep; pick a delimiter that is not in the pattern.
  const delim = ['%', '#', '|', '@', '~'].find((d) => !pattern.includes(d))!;
  const args = ['-n', ...(flavor === 'ere' ? ['-E'] : []), `\\${delim}${pattern}${delim}p`];
  return run('sed', args, { input: text, check: true }).stdout.toString().split('\n').filter(Boolean);
}

const cases: [string, 'bre' | 'ere' | 'pcre'][] = [
  ['^[A-Z]{3}-[0-9]+$', 'ere'], ['colou\\?r', 'bre'], ['^ERROR', 'bre'], ['(foo|bar)-\\1', 'ere'], ['\\(ab\\)\\{2\\}', 'bre'],
  ['^v([0-9]+)\\.([0-9]+)$', 'ere'], ['[[:digit:]]\\{4\\}-[[:digit:]]\\{2\\}', 'bre'], ['a+(b)', 'bre'], ['^#', 'bre'],
  ['[^0-9]+', 'ere'], ['^[a-z_][a-z0-9_]*=', 'ere'], ['\\.log$', 'bre'], ['x{2,3}y?', 'ere'], ['[]a]b', 'ere'],
  ['(?<=id=)\\d+', 'pcre'], ['\\bfoo\\b', 'pcre'], ['^\\s*#', 'pcre'], ['(?<year>\\d{4})-\\d\\d', 'pcre'],
  ['^a{,2}$', 'ere'], ['^a\\{,2\\}$', 'bre'], ['^[]a]+$', 'pcre'], ['^[^]a]x', 'pcre'], ['\\(a\\)\\1', 'bre'], ['a^b$c', 'bre'], ['a\\,b', 'ere'],
  ['(?s)a.b', 'pcre'], ['(?i)abc', 'pcre'], ['\\Aab\\z', 'pcre'], ['a\\hb', 'pcre'], ['(?P<n>a)b', 'pcre'], ['\\D\\W\\S', 'pcre'], ['(?:ab)+c', 'pcre'], ['(?!x)a', 'pcre'], ['\\w+\\s', 'ere'], ['a{2,}b', 'ere'],
  // Stacked quantifiers repeat the repeated atom: `b+?` is `(b+)?`, not a lazy `b+`.
  ['a{2}|b+?', 'ere'], ['a**b', 'ere'], ['(b+)?x', 'ere'], ['a+*b', 'ere'], ['(ab)+?c', 'ere'], ['a{2}?b', 'ere'], ['a*\\+b', 'bre'], ['^(a|b+?)c', 'ere'], ['\\(a*\\)*b', 'bre'],
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

describe('regex examples: the kind of each match', () => {
  const ex = (source: string, max?: number) => regexExamples({ source, flags: '' }, max)!;

  it('gives a match inside a longer line apart from the whole-line matches', () => {
    const e = ex('b+');
    assert.strictEqual(e.inside, 'abc b xyz');
    assert.ok(e.matching.length > 0 && !e.matching.includes(e.inside!));
    // Every example `matching` holds is a whole line: the pattern also matches it with nothing around.
    for (const x of e.matching) assert.ok(/^b+$/.test(x), x);
  });

  it('pads only the side that is not anchored', () => {
    assert.strictEqual(ex('^b').inside, 'b xyz');
    assert.strictEqual(ex('b$').inside, 'abc b');
    assert.strictEqual(ex('^b+$').inside, undefined);
  });

  it('has no inside example where the padding breaks the match', () => {
    assert.strictEqual(ex('^b+$|^c$').inside, undefined);
    assert.strictEqual(ex('^a.c$').inside, undefined);
  });

  it('keeps the whole-line examples at most `max`, the inside one taking the last place', () => {
    const e = ex('[a-c]+', 3);
    assert.strictEqual(e.matching.length + (e.inside === undefined ? 0 : 1), 3);
  });

  it('does not take a whole match that looks like the padding for an inside one', () => {
    const e = ex('abc (x|y)');
    assert.ok(e.matching.every((x) => x.startsWith('abc ')));
    assert.ok(e.matching.length > 0);
  });
});

describe('regex translation', () => {
  it('turns BRE syntax into JavaScript', () => {
    assert.strictEqual(toJsRegex('\\(a\\)\\{2,\\}b+?', 'bre')!.source, '(a){2,}b\\+\\?');
    assert.strictEqual(toJsRegex('*a', 'bre')!.source, '\\*a');
    // GNU grep -E reads a `{` that starts no interval as itself (GNU sed rejects it).
    assert.strictEqual(toJsRegex('a{x', 'ere')!.source, 'a\\{x');
    assert.strictEqual(toJsRegex('[[:upper:]]\\<x\\>', 'bre')!.source, '[A-Z]\\bx\\b');
  });

  it('wraps a repeated atom that is repeated again', () => {
    assert.strictEqual(toJsRegex('b+?', 'ere')!.source, '(?:b+)?');
    assert.strictEqual(toJsRegex('a**', 'ere')!.source, '(?:a*)*');
    assert.strictEqual(toJsRegex('(ab)+?', 'ere')!.source, '(?:(ab)+)?');
    assert.strictEqual(toJsRegex('a{,2}{3}', 'ere')!.source, '(?:a{0,2}){3}');
    assert.strictEqual(toJsRegex('a\\{,2\\}*', 'bre')!.source, '(?:a{0,2})*');
  });

  it('declines what GNU rejects or ignores', () => {
    for (const [p, f] of [['a\\{1', 'bre'], ['a\\{\\}', 'bre'], ['a\\}', 'bre'], ['*a', 'ere'], ['a|+b', 'ere'], ['(*a)', 'ere'], ['a)', 'ere'], ['(a', 'ere']] as const) {
      assert.strictEqual(toJsRegex(p, f), undefined, `${p} ${f}`);
    }
    // grep -E keeps a `{` that starts no interval.
    assert.strictEqual(toJsRegex('a{}', 'ere')!.source, 'a\\{}');
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

describe('the grep example of several patterns', () => {
  const parser = createUnbashParser();
  const regexExamples = (line: string) => new Analyzer('en').explainLine(parser.parse(line), 0).examples.filter((x) => x.kind === 'regex');

  it('is not made when another pattern (an -e that is not plain text, or a -f file) is not known', () => {
    // (GNU grep: `-e a -e "$x"` prints the lines of either pattern, so an example of `a` alone shows the wrong lines.)
    assert.strictEqual(run('grep', ['-e', 'a', '-e', 'b'], { input: 'a\nb\nc\n' }).stdout.toString(), 'a\nb\n');
    for (const line of ['grep -e a -e "$x" f', 'grep -e "$x" -e a f', 'grep --regexp=a --regexp="$x" f', 'grep -e a -f pats f', 'grep --regexp=a --file=pats f', 'grep -f pats -e a f']) {
      assert.deepStrictEqual(regexExamples(line), [], line);
    }
    assert.strictEqual(regexExamples('grep -e a f').length, 1);
  });

  it('is not made for an inverted match of several patterns', () => {
    // (GNU grep: `-v -e a -e b` prints the lines of neither, not those without `a`.)
    assert.strictEqual(run('grep', ['-v', '-e', 'a', '-e', 'b'], { input: 'a\nb\nc\n' }).stdout.toString(), 'c\n');
    assert.deepStrictEqual(regexExamples('grep -v -e a -e b f'), []);
    assert.strictEqual(regexExamples('grep -v -e a f').length, 1);
  });
});

describe('the grep example of a line agrees with GNU grep', () => {
  // The line explained, and the same grep reading the example's lines from stdin (the file operands left out).
  const cases: [string, string[]][] = [
    ['grep -e -v foo', ['-e', '-v']], ['grep -v foo', ['-v', 'foo']], ['grep -ve foo', ['-ve', 'foo']], ['grep --invert-match -e ab f', ['--invert-match', '-e', 'ab']],
    ['grep -ix -e AB', ['-ix', '-e', 'AB']], ['grep -w -e ab f', ['-w', '-e', 'ab']], ['grep -E -e "a+b" f', ['-E', '-e', 'a+b']], ['grep -F -e a.b', ['-F', '-e', 'a.b']],
    ['grep -e -x f', ['-e', '-x']], ['grep -e -i f', ['-e', '-i']],
  ];
  const parser = createUnbashParser();
  for (const [line, args] of cases) {
    it(line, () => {
      const ex = new Analyzer('en').explainLine(parser.parse(line), 0).examples.find((x) => x.kind === 'regex');
      assert.ok(ex, 'has an example');
      // The section of the lines grep prints, and the other one.
      const printed = ex.sections.filter((s) => s.label === 'Matching lines' || s.label.startsWith('Printed')).flatMap((s) => s.lines);
      const all = ex.sections.flatMap((s) => s.lines);
      const real = run('grep', args, { input: all.join('\n') + '\n' }).stdout.toString().split('\n').filter(Boolean);
      assert.deepStrictEqual(printed, real);
    });
  }
});
