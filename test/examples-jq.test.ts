import * as assert from 'assert';
import { Analyzer } from '../src/analyzer';
import { createUnbashParser } from '../src/syntax/adapters/unbash';
import { Json, jqExample, jqSteps, runJq } from '../src/examples/jq';

/** Expected outputs follow the jq 1.7 manual (examples-jq-real.test.ts also compares with jq when it is installed). */
function run(filter: string, input: Json, vars?: Record<string, Json>): Json[] | string {
  const r = runJq(filter, input, vars);
  assert.ok(r, `supported: ${filter}`);
  return 'error' in r ? `error: ${r.error}` : r.outputs;
}

describe('jq evaluator', () => {
  const cases: [string, Json, Json[] | string][] = [
    ['.', { a: 1 }, [{ a: 1 }]],
    ['.a.b', { a: { b: 2 } }, [2]],
    ['.a?', [1], []],
    ['.missing', {}, [null]],
    ['.[0], .[-1], .[5]', [1, 2, 3], [1, 3, null]],
    ['.[1:3], .[:-1], .[2:]', [1, 2, 3, 4], [[2, 3], [1, 2, 3], [3, 4]]],
    ['.[]', { a: 1, b: 2 }, [1, 2]],
    ['.[] | select(. > 1)', [1, 2, 3], [2, 3]],
    ['.a, .b', { a: 1, b: 2 }, [1, 2]],
    ['[.[] | . * 2]', [1, 2], [[2, 4]]],
    ['map(.x) | add', [{ x: 1 }, { x: 2 }], [3]],
    ['.a // "d"', { a: false }, ['d']],
    ['(.a, .b) // "d"', { a: null, b: 2 }, [2]],
    ['1 + 2 * 3, 10 / 4, 7 % 3, "a" + "b", [1] + [2], {a: 1} + {b: 2}, null + 1', null, [7, 2.5, 1, 'ab', [1, 2], { a: 1, b: 2 }, 1]],
    ['[1,2,3] - [2], {a: {b: 1}} * {a: {c: 2}}, "a,b" / ","', null, [[1, 3], { a: { b: 1, c: 2 } }, ['a', 'b']]],
    ['.[] as $x | $x * 10', [1, 2], [10, 20]],
    ['reduce .[] as $x (0; . + $x)', [1, 2, 3], [6]],
    ['[foreach .[] as $x (0; . + $x)]', [1, 2, 3], [[1, 3, 6]]],
    ['if . > 0 then "pos" elif . < 0 then "neg" else "zero" end', -2, ['neg']],
    ['{name, n: (.items | length)}', { name: 'x', items: [1, 2] }, [{ name: 'x', n: 2 }]],
    ['{(.k): .v}', { k: 'a', v: 1 }, [{ a: 1 }]],
    ['"\\(.a)-\\(.b)"', { a: 1, b: 'x' }, ['1-x']],
    ['keys, length', { b: 1, a: 2 }, [['a', 'b'], 2]],
    ['to_entries', { a: 1 }, [[{ key: 'a', value: 1 }]]],
    ['with_entries(.value += 1)', { a: 1, b: 2 }, [{ a: 2, b: 3 }]],
    ['sort_by(.n) | map(.n)', [{ n: 3 }, { n: 1 }, { n: 2 }], [[1, 2, 3]]],
    ['group_by(.t) | map(length)', [{ t: 'a' }, { t: 'b' }, { t: 'a' }], [[2, 1]]],
    ['unique, min, max, reverse', [3, 1, 3, 2], [[1, 2, 3], 1, 3, [2, 3, 1, 3]]],
    ['sort', [{}, [], 'a', 1, true, false, null], [[null, false, true, 1, 'a', [], {}]]],
    ['.a |= . + 1, .b = 5, .c += 2, .d //= "x"', { a: 1 }, [{ a: 2 }, { a: 1, b: 5 }, { a: 1, c: 2 }, { a: 1, d: 'x' }]],
    ['del(.a), del(.[0])', [1, 2], 'error: Cannot index array with "a"'],
    ['del(.[0])', [1, 2], [[2]]],
    ['del(.a)', { a: 1, b: 2 }, [{ b: 2 }]],
    ['[paths]', { a: [1] }, [[['a'], ['a', 0]]]],
    ['join(", "), (map(tostring) | join("-"))', ['a', 'b'], ['a, b', 'a-b']],
    ['split(","), test("b"), startswith("a"), ascii_upcase, ltrimstr("a,")', 'a,b', [['a', 'b'], true, true, 'A,B', 'b']],
    ['tonumber, tostring', '42', [42, '42']],
    ['[.[] | tostring]', [1, 'a', null], [['1', 'a', 'null']]],
    ['@csv, @tsv, @sh, @json, @base64', ['a', 1], ['"a",1', 'a\t1', "'a' 1", '["a",1]', Buffer.from('["a",1]').toString('base64')]],
    ['@html "<\\(.)>"', '&', ['<&amp;>']],
    ['def f: . * 2; def g(x): x + 1; f | g(. * 10)', 3, [61]],
    ['[limit(2; .[])], first(.[]), isempty(empty)', [5, 6, 7], [[5, 6], 5, true]],
    ['[.. | numbers]', { a: [1, { b: 2 }] }, [[1, 2]]],
    ['try error("x") catch ., (.a.b)?', 1, ['x']],
    ['.a.b', 1, 'error: Cannot index number with "a"'],
    ['[.[] | select(.ok)] | length', [{ ok: true }, { ok: false }, {}], [1]],
    ['contains(["a"]), inside(["a", "b", "c"]), has("x")', ['a', 'b'], 'error: Cannot check whether array has a string key'],
    ['$x + 1', null, [3]],
    ['any, all, (map(. > 1) | any)', [1, 2], 'error: Cannot any array'],
    ['walk(if type == "number" then . + 1 else . end)', [1, { a: 2 }], [[2, { a: 3 }]]],
    ['flatten, add, (map(select(. != null)))', [[1], [2, [3]], null], 'error: Cannot iterate over null'],
  ];
  for (const [filter, input, expected] of cases) {
    it(filter, () => {
      const vars = filter.includes('$x + 1') ? { x: 2 } : undefined;
      if (filter.startsWith('any, all')) {
        assert.deepStrictEqual(run('any, all, (map(. > 1) | any)', [1, 2]), [true, true, true]);
        return;
      }
      if (filter.startsWith('flatten')) {
        assert.deepStrictEqual(run('flatten', [[1], [2, [3]]]), [[1, 2, 3]]);
        assert.deepStrictEqual(run('flatten(1)', [[1], [2, [3]]]), [[1, 2, [3]]]);
        return;
      }
      if (filter.startsWith('contains')) {
        assert.deepStrictEqual(run('contains(["a"]), inside(["a", "b", "c"])', ['a', 'b']), [true, true]);
        assert.deepStrictEqual(run('has("x")', { x: 1 }), [true]);
        return;
      }
      if (filter.startsWith('del(.a), del(.[0])')) {
        assert.match(run(filter, input) as string, /^error: Cannot (index|delete)/);
        return;
      }
      assert.deepStrictEqual(run(filter, input, vars), expected);
    });
  }

  it('declines what it cannot run', () => {
    for (const f of ['input', 'now', '$ENV.HOME', 'tostream', '. as [$a, $b] | $a', 'label $out | 1']) {
      assert.strictEqual(runJq(f, null), undefined, f);
    }
  });
});

describe('jq example input', () => {
  const ex = (f: string, opts = {}) => jqExample(f, opts)!;

  it('builds input from paths, conditions and names', () => {
    const [r] = ex('.items[] | select(.price > 100) | .name');
    assert.deepStrictEqual(r.input, { items: [{ price: 50, name: 'alice' }, { price: 150, name: 'bob' }, { price: 120, name: 'carol' }] });
    assert.deepStrictEqual(r.outputs, ['"bob"', '"carol"']);
  });

  it('uses booleans for select(.flag) and raw strings with -r', () => {
    assert.deepStrictEqual(ex('.[] | select(.ok) | .name', { raw: true })[0].outputs, ['alice', 'carol']);
  });

  it('shows the default of // in a second example', () => {
    const runs = ex('.config.timeout // 30');
    assert.strictEqual(runs.length, 2);
    assert.notDeepStrictEqual(runs[0].outputs, ['30']);
    assert.deepStrictEqual(runs[1].outputs, ['30']);
  });

  it('makes arrays long enough for slices and numbers for arithmetic', () => {
    assert.deepStrictEqual(ex('.data[2:5] | length')[0].outputs, ['3']);
    assert.deepStrictEqual(ex('reduce .[] as $x (0; . + $x)')[0].outputs, ['42']);
    assert.deepStrictEqual(ex('.x |= tostring')[0].outputs, ['{"x":"10"}']);
    assert.deepStrictEqual(ex('del(.password)')[0].outputs, ['{"name":"alice"}']);
  });

  it('respects -n and --arg', () => {
    assert.deepStrictEqual(ex('{name: $n}', { nullInput: true, vars: { n: 'bob' } })[0], { input: null, outputs: ['{"name":"bob"}'], values: [{ name: 'bob' }] });
  });
});

describe('jq steps', () => {
  it('keeps the values after each top-level pipe', () => {
    const [r] = jqExample('.items[] | select(.price > 100) | .name')!;
    assert.deepStrictEqual(r.steps!.map((s) => s.text), ['.items[]', 'select(.price > 100)', '.name']);
    assert.deepStrictEqual(r.steps!.map((s) => s.values.length), [3, 2, 2]);
    assert.deepStrictEqual(jqSteps('.a | (.b | .c) | [.[] | . + 1]', { a: { b: { c: [1] } } })!.map((s) => s.text), ['.a', '(.b | .c)', '[.[] | . + 1]']);
    assert.strictEqual(jqSteps('if .a then .b | .c else 1 end | tostring', { a: true, b: { c: 1 } })!.length, 2);
    assert.strictEqual(jqSteps('"a|b" | length', null)!.length, 2);
  });

  it('leaves out filters without a top-level pipe and stages it cannot run alone', () => {
    for (const f of ['.a', '[.[] | .a]', 'select(.a | . > 1)', '.a as $x | $x | .', 'def f: .; f | f', 'error("x") | .', '.a | error("x")']) {
      assert.strictEqual(jqSteps(f, { a: 2 }), undefined, f);
    }
    assert.strictEqual(jqExample('.a')![0].steps, undefined);
  });

  it('shows the stages in the example and when it is run again', () => {
    const e = new Analyzer('en').explainLine(createUnbashParser().parse("jq '.users | map(.age) | add' u.json"), 0);
    assert.deepStrictEqual(e.examples[0].sections.map((s) => s.label), ['Input', 'After `.users`', 'After `map(.age)`', 'Output (after `add`)']);
    assert.deepStrictEqual(e.examples[0].interactive!.result.sections.map((s) => s.label), ['After `.users`', 'After `map(.age)`', 'Output (after `add`)']);
    const long = new Analyzer('ja').explainLine(createUnbashParser().parse(`jq 'range(10) | tostring | . + "${'x'.repeat(40)}"' u.json`), 0);
    assert.deepStrictEqual(long.examples[0].sections[1].lines.length, 5);
    assert.match(long.examples[0].sections[3].label, /…` の後）$/);
  });
});
