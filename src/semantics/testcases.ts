// What a simple test gives for a value of its variable (the cases of a test's example: src/examples/runtime.ts): its
// words as the word model reads them in a condition with that value (`wordIn`), and the test as bash's `test`
// evaluates it (`testStatus`), or a pattern as `[[ == ]]` matches it. So an example says what bash does, not what
// the text of the test suggests: unquoted in `[ ]`, `x="a b"` gives two words (`[ $x = "a b" ]` fails with status 2);
// on the right of `[[ == ]]`, a value is a pattern (`[[ a\\b = $x ]]` is true for `x='a\\b'`, not `x='a\b'`).
import type { SyntaxNode } from '../syntax/tree';
import type { TestShape } from '../testexpr';
import { patternMatches, testStatus } from './conditions';
import type { StateModel } from './state';
import { patternOfChars, type WalkSource, wordIn } from './words';

/** What a test gives: true, false, or bash's error (status 2). */
export type TestOutcome = boolean | 'error';

/**
 * What the simple test `shape` of `kind` gives where its variables have the values `given`, whatever the script sets
 * them to; undefined where that is not known here: another operator of `[[ ]]` than `=`, `==` and `!=`, a word that
 * reads anything else (another variable, a glob of file names, a tilde), a test of files.
 */
export function testOutcome(kind: '[' | '[[', shape: TestShape, model: StateModel, given: Readonly<Record<string, string>>): TestOutcome | undefined {
  // (Only the values given: no other variable, no home directory, no command run.)
  const source: WalkSource = {
    variable: (name) => (Object.hasOwn(given, name) ? given[name] : undefined), tilde: () => undefined, builtinRuns: () => false, shell: () => model.shell,
  };
  const st = (n: SyntaxNode) => model.at(n).run;
  if (kind === '[') {
    const left = shape.left ? wordIn(shape.left, st(shape.left), source, 'fields', true) : [];
    const right = wordIn(shape.right, st(shape.right), source, 'fields', true);
    if (!left || !right) return undefined;
    // (The options `-o` tests are not known here.)
    const status = testStatus([...left, shape.op, ...right], { option: () => undefined });
    return status === undefined ? undefined : status === 2 ? 'error' : status === 0;
  }
  if (!shape.left || !['=', '==', '!='].includes(shape.op)) return undefined;
  // (No splitting in `[[ ]]`: the left side is its one field; the right side a pattern, its quoted characters escaped.)
  const value = wordIn(shape.left, st(shape.left), source, 'value');
  const pattern = wordIn(shape.right, st(shape.right), source, 'pattern');
  const m = value === undefined || pattern === undefined ? undefined : patternMatches(value, pattern);
  return m === undefined ? undefined : m === (shape.op !== '!=');
}

/** The pattern that matches `text` alone, as a value of a variable on the right of `[[ == ]]`: its characters as if quoted (`[ab]` gives `\[ab\]`). */
export const literalPattern = (text: string): string => patternOfChars([...text].map((c) => ({ c, quoted: true, split: false })));
