// The program echo (coreutils) reads `--help` and `--version` as options only when one of them is its one argument;
// bash's builtin prints them as text. The cases run in bash (`enable -n echo` makes `echo` the program).
import * as assert from 'assert';
import { runBash } from './support/bash';
import { allTokens, explain } from './support/explain';

/** The kind and the text of the token of `word` on the last line of `src`. */
const wordToken = (src: string, word: string): [string, string] => {
  const t = allTokens(explain(src, src.split('\n').length - 1, 'en').items).filter((x) => x.label === word).pop();
  assert.ok(t, `${word} in ${src}`);
  return [t.kind, t.explanation];
};
const out = (script: string): string => runBash(script).stdout;
const OFF = 'enable -n echo\n';

describe('the program echo: --help and --version as its one argument', () => {
  it('prints its version only for `--version` alone (bash)', () => {
    assert.match(out('enable -n echo; echo --version'), /^echo \(GNU coreutils\) /);
    assert.match(out('enable -n echo; echo --help'), /^Usage: echo /);
    assert.strictEqual(out('enable -n echo; echo --version x'), '--version x\n');
    assert.strictEqual(out('enable -n echo; echo x --version'), 'x --version\n');
    assert.strictEqual(out('enable -n echo; echo -n --version'), '--version');
    assert.strictEqual(out('enable -n echo; echo -- --version'), '-- --version\n');
    assert.strictEqual(out('echo --version'), '--version\n', 'the builtin prints the text');
  });

  it('reads them as options of the program, and as text for the builtin', () => {
    assert.deepStrictEqual(wordToken(`${OFF}echo --version`, '--version'), ['option', 'print the version']);
    assert.deepStrictEqual(wordToken(`${OFF}echo --help`, '--help'), ['option', 'show help']);
    assert.deepStrictEqual(wordToken('/bin/echo --version', '--version'), ['option', 'print the version']);
    assert.deepStrictEqual(wordToken('env echo --version', '--version'), ['option', 'print the version']);
    assert.deepStrictEqual(wordToken(`${OFF}shopt -s expand_aliases\nalias e=echo\ne --version`, '--version'), ['option', 'print the version']);
    assert.deepStrictEqual(wordToken('echo --version', '--version'), ['argument', 'text to print']);
    // (Not the only argument: text.)
    assert.deepStrictEqual(wordToken(`${OFF}echo --version x`, '--version'), ['argument', 'text to print']);
    assert.deepStrictEqual(wordToken(`${OFF}echo x --version`, '--version'), ['argument', 'text to print']);
    assert.deepStrictEqual(wordToken(`${OFF}echo --version "$@"`, '--version'), ['argument', 'text to print']);
    assert.deepStrictEqual(wordToken(`${OFF}echo -- --version`, '--version'), ['argument', 'text to print']);
    // (A word not known, `$x`, may be an option or not.)
    assert.ok(allTokens(explain(`${OFF}echo $x`, 1, 'en').items).some((x) => x.kind === 'argument' && x.explanation === 'text to print'));
    assert.ok(allTokens(explain(`${OFF}echo --$x`, 1, 'en').items).some((x) => x.kind === 'option' && /known only at run time/.test(x.explanation)));
  });
});
