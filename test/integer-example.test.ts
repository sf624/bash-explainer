// The worked examples of `${y:=w}` and the other defaults for a variable with the integer attribute, which the model
// knows (`shellState`, `isInteger` in src/explain/reads.ts): bash does arithmetic on what an integer variable is given,
// so `declare -i y; : ${y:=p=3}` gives 3 (and sets `p`), and `y=hello` is 0. The cases are checked with bash.
import * as assert from 'assert';
import { Analyzer } from '../src/analyzer';
import { exampleFor, parseExpansion } from '../src/expansion';
import { createUnbashParser } from '../src/syntax/adapters/unbash';
import { runBash } from './support/bash';

const parser = createUnbashParser();

/** The examples of the last line of `src`, as "label → lines" strings. */
function examples(src: string, lang: 'ja' | 'en' = 'en'): string[] {
  const ex = new Analyzer(lang).explainLine(parser.parse(src), src.split('\n').length - 1);
  return ex.examples.flatMap((e) => e.sections.map((sec) => `${sec.label} → ${sec.lines.join(' ') || sec.empty}`));
}

describe('the worked examples of a default for an integer variable', () => {
  it('shows the arithmetic value of the word, and a number for a variable that is set', () => {
    assert.deepStrictEqual(examples('declare -i y\n: ${y:=p=3}'), ['When y is unset or empty → 3', 'When `y=42` → 42']);
    assert.deepStrictEqual(examples('declare -i y\n: ${y:=p=3}', 'ja'), ['y が未設定か空のとき → 3', '`y=42` のとき → 42']);
    assert.deepStrictEqual(examples('declare -i y\necho ${y:=1+2}'), ['When y is unset or empty → 3', 'When `y=42` → 42']);
  });

  it('says the word is arithmetic where its value is not known, and follows a nameref', () => {
    assert.deepStrictEqual(examples('declare -i y\necho ${y:=a$b}'), ['When y is unset or empty → the value of the arithmetic expression `a$b`', 'When `y=42` → 42']);
    assert.deepStrictEqual(examples('declare -i y\necho ${y:=hello}', 'ja'), ['y が未設定か空のとき → 算術式 `hello` の値', '`y=42` のとき → 42']);
    assert.deepStrictEqual(examples('declare -i y\ndeclare -n r=y\n: ${r:=p=3}'), ['When r is unset or empty → 3', 'When `r=42` → 42']);
  });

  it('keeps the strings for a variable that is not an integer, or may not be', () => {
    assert.deepStrictEqual(examples('y=\n: ${y:=p=3}'), ['When y is unset or empty → p=3', 'When `y=hello` → hello']);
    assert.deepStrictEqual(examples('declare -i y\ny=1\ndeclare +i y\n: ${y:=p=3}'), ['When y is unset or empty → p=3', 'When `y=hello` → hello']);
    assert.deepStrictEqual(examples('declare -i y\n: ${y:=p=3}').length, 2);
  });

  // [expansion, the result of the case of an unset variable, when the case is exact]
  const defaults: [string, string | undefined][] = [
    ['${y:=p=3}', '3'], ['${y:=1+2}', '3'], ['${y=7}', '7'], ['${y:-w}', 'w'], ['${y-w}', 'w'], ['${y:+w}', ''], ['${y+w}', ''], ['${y:?}', undefined],
    ['${#y}', undefined], ['${y:=hello}', undefined], ['${y:=a b}', undefined],
  ];
  for (const [text, first] of defaults) {
    it(`${text} is what bash gives`, () => {
      const ex = exampleFor(parseExpansion(text)!, 'en', { integer: true })!;
      assert.ok(ex.length > 0);
      for (const c of ex) {
        // (A word whose value the example does not know is said as arithmetic: no value to compare.)
        if (/arithmetic expression/.test(c.result)) continue;
        // (A message to stderr and an exit: `${y:?}` is compared elsewhere.)
        if (/prints the error/.test(c.result)) continue;
        const r = runBash(`${c.setup}; printf %s "${text}"`);
        assert.strictEqual(r.stdout, c.result, `${c.setup}; ${text}`);
      }
      if (first !== undefined) assert.strictEqual(ex.find((c) => /unset/.test(c.when))?.result ?? ex[0].result, first);
      // (An integer variable set to nothing holds 0, so no case sets it to an empty string.)
      assert.ok(!ex.some((c) => /=""/.test(c.when)), text);
    });
  }
});
