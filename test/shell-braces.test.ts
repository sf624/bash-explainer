// Brace expansion by shell where a word's value matters: `unset {a,b}` (the names bash passes), `trap {x,EXIT}` (a text in
// dash, not "known only when it runs"). Each case is compared with the real shell; dash is skipped when it is not installed.
import * as assert from 'assert';
import { spawnSync } from 'child_process';
import { staticWordValue } from '../src/staticword';
import { shellState } from '../src/semantics/state';
import { createUnbashParser } from '../src/syntax/adapters/unbash';
import { descendants } from '../src/syntax/tree';
import { runBash } from './support/bash';
import { Analyzer } from '../src/analyzer';
import { featureWorks, type Shell } from '../src/dialect';
import { allTokens } from './support/explain';

const parser = createUnbashParser();
/** The tokens of the last line of `src`, explained for `shell` (bash when absent). */
const tokensOf = (src: string, shell?: Shell) => allTokens(new Analyzer('en').explainLine(parser.parse(src), src.split('\n').length - 1, shell).items);
const dashAvailable = spawnSync('dash', ['-c', ':']).status === 0;
const dash = (code: string): string => spawnSync('dash', ['-c', code], { encoding: 'utf8', env: { PATH: '/usr/bin:/bin', LC_ALL: 'C' } }).stdout;

/** What the model says of `name` after `src`, run by `shell`: unset, a value, or `?`. */
function modelOf(src: string, name: string, shell?: 'dash'): string {
  const v = shellState(parser.parse(src), shell).end.variables.get(name);
  return !v || v.set === 'off' ? 'unset' : v.value ?? '?';
}

describe('unset with a brace expansion', () => {
  it('unsets the words bash passes, and the model follows', () => {
    assert.strictEqual(runBash('a=1 b=2; unset {a,b}; echo "[$a$b]"').stdout, '[]\n');
    assert.deepStrictEqual([modelOf('a=1 b=2; unset {a,b}', 'a'), modelOf('a=1 b=2; unset {a,b}', 'b')], ['unset', 'unset']);
    assert.strictEqual(runBash('a1=1 a2=2 a3=3; unset a{1,3}; echo "[$a1$a2$a3]"').stdout, '[2]\n');
    assert.deepStrictEqual(['a1', 'a2', 'a3'].map((n) => modelOf('a1=1 a2=2 a3=3; unset a{1,3}', n)), ['unset', '2', 'unset']);
    // (`set +B`: no brace expansion, so no variable of these names is unset.)
    assert.strictEqual(runBash('set +B; a=1; unset {a,b}; echo "[$a]"').stdout, '[1]\n');
    assert.strictEqual(modelOf('set +B; a=1; unset {a,b}', 'a'), '1');
  });
  (dashAvailable ? it : it.skip)('is one word in dash, which unsets no variable `a`', () => {
    // (dash refuses the name `{a,b}` and ends the shell, so nothing after it runs; `a` is not unset either way.)
    assert.strictEqual(dash('a=1; unset {a,b} 2>/dev/null; echo "[$a]"'), '');
    assert.strictEqual(dash('a=1; (unset {a,b}) 2>/dev/null; echo "[$a]"'), '[1]\n');
    assert.strictEqual(modelOf('a=1; (unset {a,b})', 'a', 'dash'), '1');
  });
  it('labels the names bash unsets, not the text of the word', () => {
    const label = (src: string, shell?: Shell) => tokensOf(src, shell).find((t) => t.label === '{a,b}')?.explanation;
    assert.match(label('unset {a,b}')!, /^The braces expand to 2 words first: unset the variables `a`, `b`/);
    assert.match(label('unset -f {a,b}')!, /remove the functions `a`, `b`/);
    // dash has no brace expansion: the name is `{a,b}`, and the label says so as it does for any name.
    assert.match(label('unset {a,b}', 'dash')!, /Unset the variable `\{a,b\}`/);
  });
});

describe('a word with a brace in dash', () => {
  it('lists the shells with no brace expansion as the dialect table does', () => {
    const none = (['sh', 'dash', 'ash', 'yash', 'ksh', 'mksh', 'zsh', 'bash'] as const).filter((sh) => !featureWorks('braceList', sh) && !featureWorks('braceRange', sh));
    const word = descendants(parser.parse('echo {a,b}').root, ['word']).find((w) => w.text === '{a,b}')!;
    const plain = (['sh', 'dash', 'ash', 'yash', 'ksh', 'mksh', 'zsh', 'bash'] as const).filter((sh) => staticWordValue(word, false, sh) !== undefined);
    assert.deepStrictEqual(plain, none);
  });
  it('has a value there, not in bash', () => {
    const word = (src: string) => descendants(parser.parse(src).root, ['word']).find((w) => w.text === '{x,EXIT}')!;
    assert.strictEqual(staticWordValue(word('trap {x,EXIT} INT'), false, 'dash'), '{x,EXIT}');
    assert.strictEqual(staticWordValue(word('trap {x,EXIT} INT'), false, 'sh'), '{x,EXIT}');
    assert.strictEqual(staticWordValue(word('trap {x,EXIT} INT')), undefined);
    assert.strictEqual(staticWordValue(word('trap {x,EXIT} INT'), false, 'bash'), undefined);
    assert.strictEqual(staticWordValue(word('trap {x,EXIT} INT'), false, 'mksh'), undefined);
  });
  (dashAvailable ? it : it.skip)('is the action of `trap` in dash, a command to explain; bash expands it first', () => {
    assert.strictEqual(dash('trap {x,EXIT} INT; trap'), "trap -- '{x,EXIT}' INT\n");
    const arg = (src: string, shell?: Shell) => tokensOf(src, shell).find((t) => t.label === '{x,EXIT}' && t.kind === 'argument')!;
    const inDash = arg('trap {x,EXIT} INT', 'dash');
    assert.doesNotMatch(inDash.explanation, /known only when it runs/);
    assert.ok(inDash.children.some((c) => c.kind === 'command'), 'read as a script of one command');
    // bash: two words (the action `x`, the signal `EXIT`), so there is no string it can read.
    assert.ok(!arg('trap {x,EXIT} INT').children.some((c) => c.kind === 'command'));
  });
});
