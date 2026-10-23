// The one table of command aliases (src/dict/aliases.ts): the spec lookup, the regex dialect and the example
// runner read it. The runner is compared with the real grep; the shell names that reach the `sh` spec are the
// mapping of src/dialect.ts, and dash (installed) accepts the options that spec lists.
import * as assert from 'assert';
import { execFileSync, spawnSync } from 'child_process';
import { Analyzer, type Token } from '../src/analyzer';
import { aliasOf, canonicalName, impliedWords, lookupCommand } from '../src/dict/aliases';
import { commands } from '../src/dict/commands';
import { runner } from '../src/examples/pipeline';
import { shellFromName } from '../src/dialect';
import { createUnbashParser } from '../src/syntax/adapters/unbash';
import { allTokens } from './support/explain';

const stage = (cmd: string, ...words: string[]) => ({ cmd, words, text: [cmd, ...words].join(' ') });
const input = ['a.c', 'abc', 'aac', 'xyz', 'a+c'];

function tokens(src: string): Token[] {
  const ex = new Analyzer('en').explainLine(createUnbashParser().parse(src), 0);
  return allTokens(ex.items);
}

describe('the table of command aliases', () => {
  it('names the spec an alias uses, also by path', () => {
    assert.strictEqual(canonicalName('egrep'), 'grep');
    assert.strictEqual(canonicalName('/usr/bin/fgrep'), 'grep');
    for (const n of ['gawk', 'mawk', 'nawk']) assert.strictEqual(canonicalName(n), 'awk');
    assert.strictEqual(canonicalName('python'), 'python3');
    assert.strictEqual(canonicalName('grep'), 'grep');
    assert.strictEqual(aliasOf('constructor'), undefined);
    assert.deepStrictEqual(impliedWords('egrep'), ['-E']);
    assert.deepStrictEqual(impliedWords('fgrep'), ['-F']);
    assert.deepStrictEqual(impliedWords('gawk'), []);
    assert.strictEqual(lookupCommand('egrep'), commands.grep);
    assert.strictEqual(lookupCommand('/usr/bin/mawk'), commands.awk);
    assert.strictEqual(lookupCommand('python'), commands.python3);
  });

  it('runs egrep and fgrep as grep -E and grep -F do (compared with the real grep)', () => {
    for (const [alias, flag, pattern] of [['egrep', '-E', 'a+c'], ['fgrep', '-F', 'a.c'], ['egrep', '-E', 'a.c|xyz']]) {
      const real = execFileSync('grep', [flag, pattern], { input: input.join('\n') + '\n', encoding: 'utf8' }).split('\n').slice(0, -1);
      assert.deepStrictEqual(runner(stage(alias, pattern))!(input), real, alias + ' ' + pattern);
      assert.deepStrictEqual(runner(stage('grep', flag, pattern))!(input), real);
    }
  });

  it('reads an fgrep pattern as a fixed string', () => {
    const t = tokens("fgrep 'a.b' f");
    assert.match(t.find((x) => x.kind === 'argument')!.explanation, /fixed string/);
    assert.ok(!t.some((x) => x.label === '.'));
  });
});

describe('shells other than bash take the options of sh', () => {
  // dash, zsh and ksh already did; the other names of the mapping in src/dialect.ts do now.
  it('follows the shell-name mapping of dialect.ts', () => {
    for (const n of ['dash', 'zsh', 'ksh', 'ksh93', 'mksh', 'lksh', 'pdksh', 'oksh', 'posh', 'yash', 'ash', '/bin/dash']) {
      assert.ok(shellFromName(n.split('/').pop()!), n);
      assert.strictEqual(lookupCommand(n), commands.sh, n);
    }
    assert.strictEqual(lookupCommand('busybox'), undefined);
    for (const n of ['bash', 'bash5', '/usr/bin/bash5.2']) assert.strictEqual(lookupCommand(n), commands.bash, n);
  });

  it('lists options that the real dash takes', () => {
    const names = new Set((commands.sh.options ?? []).flatMap((o) => o.names));
    for (const o of ['-c', '-n', '-e', '-x', '-u']) assert.ok(names.has(o), o);
    assert.strictEqual(spawnSync('dash', ['-n', '-e', '-u', '-c', 'echo hi']).status, 0);
  });
});
