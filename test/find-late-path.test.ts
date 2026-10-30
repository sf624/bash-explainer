// A word in find's expression that no test, action or operator takes is a path after the expression, which GNU find
// refuses ("paths must precede expression"; the real find is run in test/count-hedges-real.test.ts). The starting points
// before the expression are read as before.
import * as assert from 'assert';
import { interpret } from '../src/argv/interpret';
import { lookupCommand } from '../src/dict/aliases';
import { allTokens, explain } from './support/explain';

const said = (line: string, word: string, lang: 'ja' | 'en' = 'en'): string =>
  allTokens(explain(line, 0, lang).items).find((t) => t.label === word && t.kind === 'argument')!.explanation;
/** The words of the expression that find refuses (operands of the spec of its tests: all of them are late paths). */
const late = (...words: string[]): string[] => {
  const spec = lookupCommand('find')!.expressionSpec!;
  const parse = interpret(spec, words.map((value) => ({ value })), { name: 'find', lookup: lookupCommand });
  return parse.roles.flatMap(({ word, role }) => (role.role === 'operand' && role.spec?.extra?.says === 'paths must precede expression' ? [words[word]] : []));
};

describe('a path after the start of find\'s expression', () => {
  it('is refused by find, as the explanation of the word says', () => {
    assert.match(said('find . -name a.txt b.txt -exec rm {} \\;', 'b.txt'), /a path after the expression, which find refuses \(it prints `paths must precede expression`/);
    assert.match(said('find . -name a.txt b.txt -exec rm {} \\;', 'b.txt', 'ja'), /式の後ろに書かれたパス（find は受け付けず、`paths must precede expression`/);
  });
  it('is the case of a variable that gives several words after -name', () => {
    assert.match(said('find . -name $f -exec rm {} \\;', '$f'), /this value is the first word `\$f` gives, and each of the others is a path after the expression, which find refuses/);
  });
  it('is an operand of the expression with the spec\'s refusal, and the words before the expression are starting points as before', () => {
    assert.deepStrictEqual(late('-name', 'a.txt', 'b.txt', 'c.txt'), ['b.txt', 'c.txt']);
    assert.deepStrictEqual(late('-name', 'a.txt', '-print'), []);
    assert.match(said('find *.txt -name x', '*.txt'), /^starting directory/);
    assert.match(said('find a b -name x', 'b'), /^starting directory/);
  });
});
