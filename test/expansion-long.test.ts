// `${x#p}`, `${x%p}` and `${x/p/r}` on a long value, against bash: the model (src/semantics/words.ts) finds where a match ends
// with one walk of the engine, not a run for each end, so that the steps of the limit are not spent on what is no match.
import * as assert from 'assert';
import { shellState } from '../src/semantics/state';
import { wordFields } from '../src/semantics/words';
import { createUnbashParser } from '../src/syntax/adapters/unbash';
import { descendants, field, fields } from '../src/syntax/tree';
import { run } from './support/run';

const parser = createUnbashParser();
/** The fields the model gives of the argument of `echo`, after the assignments before it. */
function model(script: string): readonly string[] | undefined {
  const tree = parser.parse(script);
  const state = shellState(tree, 'bash', { read: 'script' });
  const echo = descendants(tree.root, ['command']).find((c) => field(c, 'name')?.text === 'echo')!;
  return wordFields(fields(echo, 'argument')[0], state).fields;
}

const VALUES = ['a'.repeat(1500), 'ab'.repeat(400) + 'c', 'a/b/c.tar.gz', 'aAbB', ''];
const EXPANSIONS = [
  '${x//b/c}', '${x//a/c}', '${x/a/c}', '${x/b/c}', '${x/#a/c}', '${x/#b/c}', '${x/%a/c}', '${x/%c/d}', '${x//a*b/c}', '${x//[ab]/c}', '${x//?/c}', '${x//ab/}', '${x//a?/z}',
  '${x##*b}', '${x#*b}', '${x##a*}', '${x##a}', '${x##z}', '${x#a}', '${x#z}', '${x%b*}', '${x%%b*}', '${x%a}', '${x%%a}', '${x%z}', '${x%%z}', '${x##*/}', '${x%/*}', '${x%%/*}', '${x#*/}', '${x%.*}', '${x%%.*}',
  '${x^^}', '${x,,}', '${x^}', '${x,}',
];

describe('expansions of a long value', () => {
  it('give what bash gives', () => {
    const rows = VALUES.flatMap((value) => EXPANSIONS.map((e) => ({ value, e })));
    const script = rows.map(({ value, e }) => `x='${value}'; printf '%s\\n' "${e}"`).join('\n');
    const real = run('bash', ['-c', script]).stdout.toString().split('\n').slice(0, -1);
    const got = rows.map(({ value, e }) => model(`x='${value}'; echo "${e}"`)?.[0]);
    const differ = rows.filter((_, i) => got[i] !== real[i]).map(({ value, e }, i) => `${value.slice(0, 12)} ${e}: ${got[i]?.slice(0, 20)}`);
    assert.deepStrictEqual(differ, []);
  });

  it('a value of 3000 characters and a pattern that fails at once, thirty on a line', function () {
    // (A run for each end was 4.5 million runs of each: 30 s, and this one was not computed.)
    this.timeout(15000);
    const x = 'a'.repeat(3000);
    assert.deepStrictEqual(model(`x=${x}; echo "\${x//b/c}"`), [x]);
    for (let k = 0; k < 30; k++) assert.deepStrictEqual(model(`x=${x}; y=${k}; echo "\${x//b/c}"`), [x]);
    assert.deepStrictEqual(model(`x=${x}; echo "\${x//a/c}"`), ['c'.repeat(3000)]);
  });

  it('what the replacements come to counts', () => {
    const r = 'r'.repeat(5000);
    assert.strictEqual(model(`x=${'a'.repeat(3000)}; echo "\${x//a/${r}}"`), undefined);
    assert.deepStrictEqual(model(`x=aa; echo "\${x//a/${r}}"`), [r + r]);
  });

  it('a pattern that takes too long is not known', () => {
    assert.strictEqual(model(`x=${'a'.repeat(5000)}; echo "\${x//a*b/c}"`), undefined);
  });

  it('an extended glob from a variable is not read here: it depends on extglob', () => {
    assert.strictEqual(model(`p='@(a)'; x=aaa; echo "\${x#$p}"`), undefined);
    assert.strictEqual(model(`p='!(a)'; x=aaa; echo "\${x//$p/b}"`), undefined);
    assert.deepStrictEqual(model(`p='a'; x=aaa; echo "\${x#$p}"`), ['aa']);
  });
});
