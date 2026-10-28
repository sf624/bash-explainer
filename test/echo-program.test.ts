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
/** Where the model knows `POSIXLY_CORRECT` is in the program's environment, and where it knows it is not. */
const BY_ENV: [string, string] = ['argument', 'text to print (`POSIXLY_CORRECT` is in its environment, so `--version` is no option)'];
const PLAIN: [string, string] = ['option', 'print the version'];
/** Whether `--version` is read as the option on the last line of `src`: its token, or its word in an `env -S` string. */
const isVersion = (src: string): boolean => {
  const tokens = allTokens(explain(src, src.split('\n').length - 1, 'en').items);
  const word = tokens.filter((x) => x.label === '--version').pop();
  if (word) return word.kind === 'option';
  const split = tokens.find((x) => /reads them here as its own arguments/.test(x.explanation));
  assert.ok(split, `--version in ${src}`);
  return /`--version` \(print the version/.test(split.explanation);
};
/** Whether bash's run prints the version of a coreutils program. */
const isVersionBash = (script: string): boolean => /^\S+ \(GNU coreutils\)/.test(out(script));
/** The script as lines for the explainer: `a; b` is two lines, and `bash --posix -c "x"` is `x`. */
const lines = (script: string): string => script.split('; ').slice(0, -1).concat(script.split('; ').pop()!.replace(/^bash --posix -c "(.*)"$/, '$1')).join('\n');
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
      assert.strictEqual(isVersion(lines(script)), version, `explainer: ${script}`);
    }
    // (A subshell or a function the command runs in passes the exported variable on.)
    assert.ok(!isVersion('export POSIXLY_CORRECT=y\n( /bin/echo --version )'));
    assert.ok(!isVersion('export POSIXLY_CORRECT=y\nf() { /bin/echo --version; }'));
    assert.ok(isVersion('( /bin/echo --version )'));
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
    assert.deepStrictEqual(wordToken(`${OFF}POSIXLY_CORRECT=1 command echo --version`, '--version'), BY_ENV);
  });

  it('follows a command named in an `env -S` string, and find\'s actions, as bash runs them', () => {
    for (const [script, version] of [
      ['env -S env /bin/echo --version', true],
      ["env -S 'nice' /bin/echo --version", true],
      ['env -S nohup /bin/echo --version', true],
      ['env -S "env -i" /bin/echo --version', true],
      ['env -S "nice -n 1" /bin/echo --version', true],
      ['env -S "/bin/echo --version"', true],
      ['env -S "/bin/echo" --version', true],
      ['POSIXLY_CORRECT=1 env -S "/bin/echo --version"', false],
      ['POSIXLY_CORRECT=1 env -S "/bin/echo" --version', false],
      ["POSIXLY_CORRECT=1 env -S'/bin/echo --version'", false],
      ["POSIXLY_CORRECT=1 env -iS'/bin/echo --version'", true],
      ['POSIXLY_CORRECT=1 env -S "env -i /bin/echo" --version', true],
      ['POSIXLY_CORRECT=1 env -S "env -u POSIXLY_CORRECT POSIXLY_CORRECT=1 /bin/echo" --version', false],
      ['POSIXLY_CORRECT=1 find . -maxdepth 0 -exec /bin/echo --version \\;', false],
      ['POSIXLY_CORRECT=1 find . -maxdepth 0 -execdir /bin/echo --version \\;', false],
      ['POSIXLY_CORRECT=1 find . -maxdepth 0 -exec env -i /bin/echo --version \\;', true],
      ['export POSIXLY_CORRECT=1; find . -maxdepth 0 -exec /bin/echo --version \\;', false],
      ['find . -maxdepth 0 -exec /bin/echo --version \\;', true],
    ] as const) {
      assert.strictEqual(isVersionBash(script), version, script);
      assert.strictEqual(isVersion(lines(script)), version, `explainer: ${script}`);
    }
    // (sudo and doas need a password to run in bash; sudo starts the command in a new environment.)
    assert.ok(isVersion('env -S sudo /bin/echo --version'));
    assert.ok(isVersion('env -S doas /bin/echo --version'));
    assert.deepStrictEqual(wordToken('POSIXLY_CORRECT=1 sudo /bin/echo --version', '--version'), PLAIN);
  });

  it('says what the model knows of POSIXLY_CORRECT where the program runs', () => {
    // Not known (it may be in the script's environment): the option, with the words that say what the variable does.
    // (In a container or on another machine, what sets the environment there is not seen: an image's `ENV`, a remote
    // shell's startup files.)
    for (const src of ['/bin/echo --version', 'POSIXLY_CORRECT=y\n/bin/echo --version', '( /bin/echo --version )', 'docker run --env-file f img /bin/echo --version',
      'env -u FOO /bin/echo --version', 'env --unset=FOO /bin/echo --version', 'timeout -vk 1 5 /bin/echo --version', 'timeout --foreground 5 /bin/echo --version',
      'docker run img /bin/echo --version', 'export POSIXLY_CORRECT=1\ndocker run img /bin/echo --version', 'ssh host /bin/echo --version', "env -i ssh host '/bin/echo --version'"]) {
      assert.deepStrictEqual(wordToken(src, '--version'), ['option', VERSION], src);
      if (!/^(docker|POSIX|export|ssh|env -i ssh)/.test(src)) assert.ok(isVersionBash(src), src);
    }
    // (Another option alone is the option it is.)
    assert.deepStrictEqual(wordToken('/bin/echo -n', '-n'), ['option', 'do not print the trailing newline']);
    // Surely not there: the option, and nothing more.
    for (const src of ['env -i /bin/echo --version', 'env -u POSIXLY_CORRECT /bin/echo --version', 'unset POSIXLY_CORRECT\n/bin/echo --version',
      'export POSIXLY_CORRECT=1\nexport -n POSIXLY_CORRECT\n/bin/echo --version', 'env -i env -i /bin/echo --version',
      'POSIXLY_CORRECT=1 doas /bin/echo --version', 'export POSIXLY_CORRECT=1\ndoas -u u /bin/echo --version']) {
      assert.deepStrictEqual(wordToken(src, '--version'), PLAIN, src);
    }
    // Surely there: text, and why.
    for (const src of ['POSIXLY_CORRECT=1 /bin/echo --version', 'export POSIXLY_CORRECT=1\n/bin/echo --version', 'docker run -e POSIXLY_CORRECT=1 img /bin/echo --version']) {
      assert.deepStrictEqual(wordToken(src, '--version'), BY_ENV, src);
    }
    assert.ok(isVersionBash('unset POSIXLY_CORRECT; /bin/echo --version'));
    assert.ok(isVersionBash('export POSIXLY_CORRECT=1; export -n POSIXLY_CORRECT; /bin/echo --version'));
    assert.ok(isVersionBash('env -i env -i /bin/echo --version'));
    // (ja)
    const ja = (src: string): string => allTokens(explain(src, 0, 'ja').items).filter((x) => x.label === '--version').pop()!.explanation;
    assert.strictEqual(ja('/bin/echo --version'), 'バージョンを表示する（環境に `POSIXLY_CORRECT` があると、ただの文字列）');
    assert.strictEqual(ja('POSIXLY_CORRECT=1 /bin/echo --version'), '表示する文字列（環境に `POSIXLY_CORRECT` があるので、`--version` はオプションではない）');
    assert.strictEqual(ja('env -i /bin/echo --version'), 'バージョンを表示する');
  });

  it('starts from the state of the shell that runs the program: what that shell sets is not undone by the links before it', () => {
    for (const [script, version] of [
      ["env -i bash -c 'POSIXLY_CORRECT=1 /bin/echo --version'", false],
      ["env -i bash -c 'export POSIXLY_CORRECT=1; /bin/echo --version'", false],
      ["env -u POSIXLY_CORRECT bash -c 'POSIXLY_CORRECT=1 /bin/echo --version'", false],
      ["env -i sh -c 'set -a; POSIXLY_CORRECT=1; /bin/echo --version'", false],
      ["export POSIXLY_CORRECT=1; env -i bash -c '/bin/echo --version'", true],
      ["export POSIXLY_CORRECT=1; env -u POSIXLY_CORRECT bash -c '/bin/echo --version'", true],
      ["export POSIXLY_CORRECT=1; bash -c '/bin/echo --version'", false],
      ["export POSIXLY_CORRECT=1; bash -c 'env -i /bin/echo --version'", true],
      ["env -i bash -c '/bin/echo --version'", true],
      ['bash -c \'export POSIXLY_CORRECT=1; env -i bash -c "/bin/echo --version"\'', true],
      ['env -i bash -c \'export POSIXLY_CORRECT=1; bash -c "/bin/echo --version"\'', false],
    ] as const) {
      assert.strictEqual(isVersionBash(script), version, script);
      // (The explainer reads the line after the last `; ` outside the quotes.)
      const src = script.startsWith('export ') ? script.replace('; ', '\n') : script;
      assert.strictEqual(isVersion(src), version, `explainer: ${script}`);
    }
  });

  it('shows no example of what printf prints when it reads `--help` or `--version`', () => {
    const titles = (src: string): string[] => explain(src, 0, 'en').examples.map((e) => `${e.title} ${e.target ?? ''}`);
    assert.match(out('/usr/bin/printf --version'), /^printf \(GNU coreutils\)/);
    assert.deepStrictEqual(titles('/usr/bin/printf --version'), []);
    assert.deepStrictEqual(titles('env /usr/bin/printf --help'), []);
    assert.ok(!titles('/usr/bin/printf --help | tr a-z A-Z').some((t) => /printf/.test(t)));
    // (Not alone, it is the format.)
    assert.strictEqual(out('/usr/bin/printf --version x'), '--version');
    assert.strictEqual(titles('/usr/bin/printf --version x').length, 1);
  });

  it('follows xargs: a later `-L` or `-l` turns a replace string off, a later `-I` or `-i` turns them off', () => {
    for (const [script, version] of [
      ['echo a | xargs -I{} -L1 /bin/echo --version', false],
      ['echo a | xargs -i -l /bin/echo --version', false],
      ['echo a | xargs -L1 -I{} /bin/echo --version', true],
      ['echo a | xargs -I{} -n1 /bin/echo --version', true],
      // (xargs runs the program, not the builtin.)
      ['echo a | xargs -I{} echo --version', true],
    ] as const) {
      assert.strictEqual(isVersionBash(script), version, script);
      assert.strictEqual(isVersion(script), version, `explainer: ${script}`);
    }
    // (The words xargs adds come after the whole line, so not into find's `-exec … \;`: find refuses them.)
    assert.match(runBash('echo a | xargs find . -maxdepth 0 -exec /bin/echo --version \\;').stderr, /paths must precede expression/);
    assert.ok(isVersion('echo a | xargs find . -exec /bin/echo --version \\;'));
  });

  it('reads `--help` and `--version` of coreutils printf, true and false only as their one argument, whatever the environment', () => {
    for (const [script, word, option] of [
      ['/usr/bin/printf --version', '--version', true],
      ['POSIXLY_CORRECT=1 /usr/bin/printf --version', '--version', true],
      ['env printf --help', '--help', true],
      ['/usr/bin/printf --version x', '--version', false],
      ['/usr/bin/printf -- --version', '--version', false],
      ['/bin/true --version', '--version', true],
      ['env false --help', '--help', true],
      ['env true --version x', '--version', false],
    ] as const) {
      const printed = out(script);
      assert.strictEqual(/^\S+ \(GNU coreutils\)|^Usage: /.test(printed), option, `${script}: ${printed}`);
      const [kind, text] = wordToken(script, word);
      assert.strictEqual(kind === 'option', option, `explainer: ${script}`);
      if (option) assert.strictEqual(text, word === '--help' ? 'show the usage' : 'print the version');
    }
  });
});
