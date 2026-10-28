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
const VERSION = 'print the version (plain text if `POSIXLY_CORRECT` is in the environment)';
const HELP = 'show the usage (plain text if `POSIXLY_CORRECT` is in the environment)';
const TEXT: [string, string] = ['argument', 'text to print'];
const isVersion = (src: string): boolean => wordToken(src, '--version')[0] === 'option';
const isVersionBash = (script: string): boolean => /^echo \(GNU coreutils\)/.test(out(script));
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
    assert.deepStrictEqual(wordToken(`${OFF}echo --version`, '--version'), ['option', VERSION]);
    assert.deepStrictEqual(wordToken(`${OFF}echo --help`, '--help'), ['option', HELP]);
    assert.deepStrictEqual(wordToken('/bin/echo --version', '--version'), ['option', VERSION]);
    assert.deepStrictEqual(wordToken('env echo --version', '--version'), ['option', VERSION]);
    assert.deepStrictEqual(wordToken(`${OFF}shopt -s expand_aliases\nalias e=echo\ne --version`, '--version'), ['option', VERSION]);
    assert.deepStrictEqual(wordToken('echo --version', '--version'), TEXT);
    // (Not the only argument: text.)
    assert.deepStrictEqual(wordToken(`${OFF}echo --version x`, '--version'), TEXT);
    assert.deepStrictEqual(wordToken(`${OFF}echo x --version`, '--version'), TEXT);
    assert.deepStrictEqual(wordToken(`${OFF}echo --version "$@"`, '--version'), TEXT);
    assert.deepStrictEqual(wordToken(`${OFF}echo -- --version`, '--version'), TEXT);
    // (A word not known, `$x`, may be an option or not.)
    assert.ok(allTokens(explain(`${OFF}echo $x`, 1, 'en').items).some((x) => x.kind === 'argument' && x.explanation === 'text to print'));
    assert.ok(allTokens(explain(`${OFF}echo --$x`, 1, 'en').items).some((x) => x.kind === 'option' && /known only at run time/.test(x.explanation)));
  });

  it('reads them as text after a word that appends arguments (`xargs`), and as options after a replace string', () => {
    // (xargs adds its input after the command's words: `--version` is not the one argument. With `-I{}` it is.)
    assert.strictEqual(out('echo a | xargs echo --version'), '--version a\n');
    assert.strictEqual(out('echo a | xargs -r /bin/echo --version'), '--version a\n');
    assert.strictEqual(out('echo a | xargs -I{} /bin/echo --version').split('\n')[0].slice(0, 4), 'echo');
    assert.strictEqual(out('echo a | xargs -i /bin/echo --version').split('\n')[0].slice(0, 4), 'echo');
    assert.strictEqual(out('echo a | xargs -r /bin/echo --version x'), '--version x a\n');
    assert.ok(!isVersion('echo a | xargs /bin/echo --version'));
    assert.ok(!isVersion('echo a | xargs -r /bin/echo --version'));
    assert.ok(!isVersion('echo a | xargs env /bin/echo --version'));
    assert.ok(isVersion('echo a | xargs -I{} /bin/echo --version'));
    assert.ok(isVersion('echo a | xargs -i /bin/echo --version'));
    assert.ok(isVersion('echo a | xargs --replace /bin/echo --version'));
    // find: the words up to `\;` are the whole command; with `{}` the path is another argument.
    assert.ok(isVersionBash('find . -maxdepth 0 -exec /bin/echo --version \\;'));
    assert.strictEqual(out('find . -maxdepth 0 -exec /bin/echo --version {} \\;'), '--version .\n');
    assert.ok(isVersion('find . -exec /bin/echo --version \\;'));
    assert.ok(!isVersion('find . -exec /bin/echo --version {} \\;'));
  });

  it('reads them as text where the command has POSIXLY_CORRECT in its environment, and says what it does where that is not known', () => {
    for (const [script, version] of [
      ['/bin/echo --version', true],
      ['POSIXLY_CORRECT=1 /bin/echo --version', false],
      ['POSIXLY_CORRECT= /bin/echo --version', false],
      ['env POSIXLY_CORRECT=1 /bin/echo --version', false],
      ['env POSIXLY_CORRECT=1 echo --version', false],
      ['export POSIXLY_CORRECT=y; /bin/echo --version', false],
      ['export POSIXLY_CORRECT=y; env -u POSIXLY_CORRECT /bin/echo --version', true],
      ['env POSIXLY_CORRECT=1 env -u POSIXLY_CORRECT /bin/echo --version', true],
      ['env -i POSIXLY_CORRECT=1 /bin/echo --version', false],
      ['POSIXLY_CORRECT=1 env -i /bin/echo --version', true],
      // (Not exported: the program does not see it. POSIX mode alone does not export it.)
      ['POSIXLY_CORRECT=y; /bin/echo --version', true],
      ['set -o posix; /bin/echo --version', true],
      ['bash --posix -c "/bin/echo --version"', true],
    ] as const) {
      assert.strictEqual(isVersionBash(script), version, script);
      const last = script.split('; ').slice(0, -1).concat(script.split('; ').pop()!.replace(/^bash --posix -c "(.*)"$/, '$1')).join('\n');
      assert.strictEqual(isVersion(last), version, `explainer: ${script}`);
    }
    assert.ok(isVersionBash('enable -n echo; command echo --version'));
    assert.ok(!isVersionBash('enable -n echo; POSIXLY_CORRECT=1 command echo --version'));
    assert.ok(!isVersion(`${OFF}POSIXLY_CORRECT=1 command echo --version`));
    // Not known: the option, with the words that say what the variable does.
    assert.strictEqual(wordToken('/bin/echo --version', '--version')[1], VERSION);
  });

  it('reads the words of `command echo` as the program\'s after `enable -n echo`', () => {
    assert.ok(isVersionBash('enable -n echo; command echo --version'));
    assert.deepStrictEqual(wordToken(`${OFF}command echo --version`, '--version'), ['option', VERSION]);
    assert.deepStrictEqual(wordToken(`${OFF}command echo --version x`, '--version'), TEXT);
    // (Without it, the builtin: text.)
    assert.deepStrictEqual(wordToken('command echo --version', '--version'), TEXT);
    assert.deepStrictEqual(wordToken(`${OFF}command echo -n hi`, '-n'), ['option', 'do not print the trailing newline']);
  });
});
