import * as assert from 'assert';
import { explainJq } from '../src/embedded/jq';
import { EmbeddedToken } from '../src/embedded/types';
import { allTokens } from './support/explain';

function shape(src: string, ts: EmbeddedToken[]): string[] {
  return ts.map((t) => src.slice(t.start, t.end));
}

function find(src: string, ts: EmbeddedToken[], text: string): EmbeddedToken {
  const t = allTokens(ts).find((x) => src.slice(x.start, x.end) === text);
  assert.ok(t, `no token "${text}"`);
  return t;
}

describe('jq explainer', () => {
  it('returns the top-level pipeline as stages and pipes', () => {
    const src = '.items[] | select(.ok) | .name';
    const ts = explainJq(src, 'en');
    assert.deepStrictEqual(shape(src, ts), ['.items[]', '|', 'select(.ok)', '|', '.name']);
    assert.match(ts[0].explanation, /^Path: `items` → each element$/);
    assert.match(ts[2].explanation, /^`select\(…\)`: pass the input through only if the condition is true/);
    assert.match(find(src, ts, '.ok').explanation, /^Argument: the value of field `ok`/);
  });

  it('explains indexes, slices and the identity', () => {
    const src = '.[0], .[-1], .a[2:5], .["k"], .';
    const ts = explainJq(src, 'en');
    assert.match(find(src, ts, '[0]').explanation, /element 0 \(0-based\)/);
    assert.match(find(src, ts, '[-1]').explanation, /the last element/);
    assert.match(find(src, ts, '[2:5]').explanation, /a slice from 2 up to \(not including\) 5/);
    assert.match(find(src, ts, '.["k"]').explanation, /`k`/);
    assert.match(find(src, ts, '.').explanation, /the input itself/);
  });

  it('follows jq precedence (| binds loosest, even inside select)', () => {
    const src = 'select(.a > 1 and .b | not)';
    const arg = find(src, explainJq(src, 'en'), '.a > 1 and .b | not');
    assert.match(arg.explanation, /Pipeline/);
    assert.deepStrictEqual(shape(src, arg.children), ['.a > 1 and .b', '|', 'not']);
  });

  it('explains objects, alternatives, updates and bindings', () => {
    const src = '{name, age: .profile.age, $id}';
    const obj = explainJq(src, 'en')[0];
    assert.deepStrictEqual(obj.children.map((c) => c.explanation.slice(0, 20)), ['Key `name` gets `.na', 'Key `age` gets `.pro', 'Key `id` gets `$id` ']);
    assert.match(explainJq('.a // "x"', 'en')[0].explanation, /if the left is null, false or an error/);
    assert.match(explainJq('.x |= tostring', 'en')[0].explanation, /update the value at the path/);
    const bind = explainJq('.[] as $x | $x * 2', 'en')[0];
    assert.match(bind.explanation, /^Binding/);
  });

  it('explains if, reduce and try', () => {
    assert.deepStrictEqual(explainJq('if .n > 0 then "p" elif .n < 0 then "n" else "z" end', 'en')[0].children.map((c) => c.explanation.split(':')[0]),
      ['Condition', 'If true', 'Next condition', 'If that is true', 'Otherwise']);
    const red = explainJq('reduce .[] as $x (0; . + $x)', 'ja')[0];
    assert.match(red.explanation, /^畳み込み/);
    assert.deepStrictEqual(red.children.map((c) => c.explanation.split(':')[0]), ['繰り返す値', '各値が入る変数 `$x`', '初期値（`.` が蓄積値）', '更新式']);
    assert.match(explainJq('try error("x") catch .', 'en')[0].explanation, /keep going on errors/);
  });

  it('handles strings, formats, definitions and comments', () => {
    assert.match(explainJq('"id: \\(.id)"', 'en')[0].explanation, /interpolated/);
    assert.match(explainJq('@csv', 'en')[0].explanation, /CSV/);
    const src = 'def inc: . + 1; .n | inc # bump';
    const ts = explainJq(src, 'en');
    assert.match(ts[0].explanation, /Defines the function `inc`/);
    assert.match(find(src, ts, 'inc').explanation, /a function \(built-in or defined/);
  });

  it('reports filters it cannot parse', () => {
    for (const bad of ['.[', 'select(', '{a:', '"open', '.a |']) {
      const ts = explainJq(bad, 'en');
      assert.strictEqual(ts[0].kind, 'error', bad);
    }
    assert.deepStrictEqual(explainJq('', 'en'), []);
  });
});
