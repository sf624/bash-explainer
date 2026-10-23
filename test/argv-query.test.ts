// The questions about a parse (src/argv/query.ts) that the examples and the dialect check ask: an option is found
// however it is written, and a value is never taken for an option.
import * as assert from 'assert';
import { lookupCommand } from '../src/analyzer';
import { interpret } from '../src/argv/interpret';
import { givenOptions, has, operands, values } from '../src/argv/query';
import { argWords } from './support/argwords';

const parseOf = (line: string) => {
  const { name, words, texts } = argWords(line);
  return { parse: interpret(lookupCommand(name)!, words, { name, lookup: lookupCommand }), texts };
};

describe('ArgvParse queries', () => {
  it('has: an option in any of its spellings, and not a value that looks like one', () => {
    const cases: [string, string, boolean][] = [
      ['grep -v foo', '-v', true], ['grep --invert-match foo', '-v', true], ['grep -iv foo', '-v', true], ['grep -v foo', '--invert-match', true],
      ['grep -e -v foo', '-v', false], ['grep -e -v foo', '-e', true], ['grep -- -v foo', '-v', false], ['grep foo -v', '-v', true],
      // A prefix of a long option, where the program takes one.
      ['timeout --pres 5 ls', '--preserve-status', true],
      // Old-style letters, and an option the spec does not know.
      ['tar xzf a.tgz', '-z', true], ['tar xzf a.tgz', '--verbose', false], ['grep -Q x', '-Q', true],
      // `set +x` turns `-x` off.
      ['set -x', '-x', true], ['set +x', '-x', false], ['set +Z', '-Z', true],
      // `sed -ie`: the `e` is the suffix of `-i`, not `-e`.
      ['sed -ie s/a/b/ f', '-i', true], ['sed -ie s/a/b/ f', '-e', false],
    ];
    for (const [line, option, expected] of cases) assert.strictEqual(has(parseOf(line).parse, option), expected, `${line}: ${option}`);
  });
  it('givenOptions: one per option, the letters of a cluster each on its own', () => {
    const { parse } = parseOf('perl -lane print f');
    assert.deepStrictEqual(givenOptions(parse).map(({ word, role }) => [word, role.flag]), [[0, '-l'], [0, '-a'], [0, '-n'], [0, '-e']]);
  });
  it('values: in the option word or after it, in order, with where they start', () => {
    const texts = (line: string, ...names: string[]) => {
      const { parse, texts: words } = parseOf(line);
      return values(parse, ...names).map(({ word, at }) => words[word].slice(at ?? 0));
    };
    assert.deepStrictEqual(texts('sed -e s/a/b/ --expression=s/c/d/ -ne p f', '-e'), ['s/a/b/', 's/c/d/', 'p']);
    assert.deepStrictEqual(texts('sed -ie s/a/b/ -e s/c/d/ f', '-e'), ['s/c/d/']);
    assert.deepStrictEqual(texts('sed -ie s/a/b/ -e s/c/d/ f', '-i'), ['e']);
    assert.deepStrictEqual(texts('grep -efoo data.txt', '-e'), ['foo']);
    assert.deepStrictEqual(texts('jq --arg a 1 --argjson b 2 .', '--arg', '--argjson'), ['a', '1', 'b', '2']);
    assert.deepStrictEqual(texts('grep --nope=x y', '--nope'), ['x']);
    // cobra takes the next word as the value of an option it does not know.
    assert.deepStrictEqual(texts('kubectl --nope x get pods', '--nope'), ['x']);
  });
  it('operands: in order, all or those of one name', () => {
    const names = (line: string, name?: string) => {
      const { parse, texts } = parseOf(line);
      return operands(parse, name).map(({ word }) => texts[word]);
    };
    assert.deepStrictEqual(names('grep -e -v foo bar'), ['foo', 'bar']);
    assert.deepStrictEqual(names('grep -e -v foo bar', 'ARG1'), []);
    assert.deepStrictEqual(names('grep pat foo bar', 'ARG1'), ['pat']);
    assert.deepStrictEqual(names('tr -d --squeeze-repeats a b'), ['a', 'b']);
    // (`true` describes no operands.)
    assert.deepStrictEqual(names('true x', 'ARG1'), []);
    assert.deepStrictEqual(names('true x'), ['x']);
  });
});
