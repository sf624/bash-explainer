import * as assert from 'assert';
import { run } from './support/run';
import { Analyzer } from '../src/analyzer';
import { regexExamples, toJsRegex } from '../src/examples/regex';
import { createUnbashParser } from '../src/syntax/adapters/unbash';

/** Lines the probe text holds: the characters the escapes below are about, one set of them on each line. */
const PROBE = ['h', 'H', '1', 'a', 'aa', 'aaa', 'A', 'b', 'ab', 'abc', 'e', 'e[0m', '\x1b[0m', 'y', 'N', ' ', 'a b', '\t', 'x', '.', '-', '\x01', '8', '\x07', 'g1', 'o{}', 'café', 'Ab', 'AB', 'C', ' \t'];

/** The lines of PROBE that `grep -P` prints, or undefined when it takes the pattern for an error. */
function grepP(pattern: string): string[] | undefined {
  const r = run('grep', ['-P', '--', pattern], { input: PROBE.join('\n') + '\n', env: { ...process.env, LC_ALL: 'C.UTF-8' } });
  return r.status === 2 ? undefined : r.stdout.toString().split('\n').filter(Boolean);
}

/**
 * Patterns the JavaScript reads otherwise than PCRE does, or not at all (the reviewer's list), and patterns it reads alike:
 * an example is made only when every construct in the pattern means the same in JavaScript.
 */
const refused = [
  '\\H+', '\\V', '\\N', '\\Nb', '\\e\\[0m', '\\a', '\\y', '\\C', '\\G', '\\g1', '(a)\\g1', '(a)\\g{-1}', '(?<n>a)\\g{n}', '(?<n>a)\\k<n>', '\\o{101}', 'o\\{\\}',
  '[\\h]', '[\\H]', '[\\V]', '[\\e]', '\\x{41}', '[\\x{41}]', '\\1', '(a)\\2', '[[:alpha:]]x', '[[:foo:]]', '(?1)', '(?|a|b)', '(*UTF)', '(?#c)a', "(?'n'a)", '(?x)a b', '\\Q.\\E',
  '\\X', '\\R', '\\K', '\\pL', '[\\pL]', '\\U', '\\u', '\\E', '\\l', '\\10', '(a)\\10', '[a-\\d]', '[\\d-z]', '[\\w-.]', '[\\w-\\d]', '[[:alpha:]-z]', '[^\\s-a]',
];
const shown = [
  '\\d', '\\D+', '\\w+', 'a\\sb', '\\bab', '\\Bb', '\\Aab', 'ab\\z', 'ab\\Z', '\\h', '\\t', '\\x41', '\\x1b\\[', '[\\x41-\\x5a]', '[\\101]', '[\\101-\\132]', '[^\\x00-\\x7F]',
  '\\101', '\\e', '\\cA', '\\o{101}', '[\\d.]', '[\\w-]', '[\\.\\]]', '(a)\\1', '(?<n>a)b', '(?P<n>a)b', '(?:ab)+', 'a(?=b)', '(?<!a)b', '[[:digit:]]', '[^[:space:]]+', '[\\b]', '\\.',
  '\\x{41}', '[\\x07]', '\\a', '\\H', '\\N', '[\\h]', '[\\t-\\r]', '\\<a', 'a\\>', '[a[b]+',
  '[-\\w.]', '[-\\d.]', '[-\\w]', '[^-\\s]', '[-[:alnum:]]', '[\\w-]', '[]-a]',
];

describe('a PCRE example is made only when JavaScript reads every construct as PCRE does', () => {
  /** The lines of `lines` that grep -P prints for `pattern`. */
  const grepLines = (pattern: string, lines: string[]) => run('grep', ['-P', '--', pattern], { input: lines.join('\n') + '\n', env: { ...process.env, LC_ALL: 'C.UTF-8' } }).stdout.toString().split('\n').filter(Boolean);

  for (const p of [...refused, ...shown]) {
    it(`${p}: no example, or one that grep -P agrees with`, () => {
      const js = toJsRegex(p, 'pcre');
      if (!js) return;
      assert.ok(grepP(p), `grep -P takes it for an error, and an example is made: /${js.source}/`);
      const re = new RegExp(js.source, js.flags);
      assert.deepStrictEqual(PROBE.filter((l) => re.test(l)), grepP(p), `${p} read as /${js.source}/${js.flags}`);
      const ex = regexExamples(js);
      if (ex) assert.deepStrictEqual(grepLines(p, [...ex.matching, ...ex.nonMatching]), ex.matching, `the example lines of ${p}`);
    });
  }

  it('what is known to mean the same is shown, so the refusal is no way out', () => {
    for (const p of ['\\d', '\\D+', '\\w+', 'a\\sb', '\\bab', '\\Aab', '\\h', '\\t', '\\x41', '[\\x41-\\x5a]', '[\\101]', '[^\\x00-\\x7F]', '(a)\\1', '(?<n>a)b', '(?P<n>a)b', '[\\.\\]]', '[[:digit:]]', '\\H', '\\N', '[\\h]', '\\e', '\\x{41}']) {
      assert.ok(toJsRegex(p, 'pcre'), p);
    }
  });

  it('a "-" that opens a class is a member, and the example stays: `[-\\w.]`', () => {
    for (const p of ['[-\\w.]', '[-\\d.]', '[-\\w]', '[^-\\s]', '[-[:alnum:]]', '[\\w-]']) assert.ok(toJsRegex(p, 'pcre'), p);
    for (const line of ["grep -oP '[-\\w.]+' f", "grep -oP '[-\\d.]+' f", "grep -oP '[^-\\s]+' f"]) assert.ok(examplesOf(line).length > 0, line);
    // (One after an item is a range with a set at an end, which grep -P refuses.)
    for (const p of ['[\\w-.]', '[a-\\d]', '[\\w-\\d]', '[[:alpha:]-z]', '[^\\s-a]']) {
      assert.strictEqual(toJsRegex(p, 'pcre'), undefined, p);
      assert.strictEqual(grepP(p), undefined, p);
    }
  });

  it('what JavaScript reads otherwise or not at all is refused', () => {
    for (const p of ['\\V', '\\y', '\\C', '\\G', '\\g1', '(a)\\g1', '(a)\\g{-1}', '\\k<n>', '[\\H]', '[\\V]', '\\x{41', '\\x{4g}', '\\1', '(a)\\2', '\\10', '(?x)a b', '[[:foo:]]', '(?1)', '(?#c)a', '\\o{}', '\\Q.\\E', '\\U', '\\X', '\\R', 'a\\', '\\x{10000}', '[[.a.]]', '[a', '[[:alpha:]', '(?x)ab']) {
      assert.strictEqual(toJsRegex(p, 'pcre'), undefined, p);
    }
  });

  const parser = createUnbashParser();
  const examplesOf = (line: string) => new Analyzer('en').explainLine(parser.parse(line), 0).examples;
  it('the lines the review found show no example, or one that matches what the tool does', () => {
    // grep -P and perl read the pattern as PCRE; the example of a pattern JavaScript reads otherwise is not made.
    for (const [line, none] of [["grep -oP '\\H+' f", false], ["grep -P '\\e\\[0m' f", false], ["grep -P '\\N' f", false], ["grep -P '\\y' f", true], ["grep -P '(a)\\g1' f", true],
      ["grep -P '(a)\\g{-1}' f", true], ["perl -ne 'print if /\\Nb/' f", false], ["perl -ne 'print if /\\y/' f", true], ["grep -P '\\C' f", true], ["grep -P '[\\H]' f", true], ["grep -P '\\o{}' f", true], ["grep -P '\\V' f", true]] as [string, boolean][]) {
      const ex = examplesOf(line);
      if (none) assert.deepStrictEqual(ex, [], line);
      else assert.ok(ex.length > 0, line);
    }
  });

  it('grep -P and perl shown the same lines as the tool prints', () => {
    for (const [pattern, line] of [['\\H+', "grep -P '\\H+' f"], ['\\N', "grep -P '\\N' f"], ['[\\h]', "grep -P '[\\h]' f"], ['\\e', "grep -P '\\e' f"]]) {
      const js = toJsRegex(pattern, 'pcre')!;
      const ex = regexExamples(js)!;
      assert.deepStrictEqual(grepLines(pattern, [...ex.matching, ...ex.nonMatching]), ex.matching, line);
    }
  });
});
