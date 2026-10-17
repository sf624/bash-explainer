import * as assert from 'assert';
import { execFileSync, spawnSync } from 'child_process';
import { Json, jqExample, runJq, toJson } from '../src/examples/jq';

/** Outputs of the real jq (compact), or an error marker. */
function realJq(filter: string, input: Json, args: string[] = []): string[] | 'error' {
  const r = spawnSync('jq', ['-c', ...args, filter], { input: JSON.stringify(input) });
  if (r.status !== 0) return 'error';
  const out = r.stdout.toString();
  return out === '' ? [] : out.replace(/\n$/, '').split('\n');
}

const hasJq = spawnSync('jq', ['--version']).status === 0;

const pairs: [string, Json][] = [
  ['.', { a: 1 }], ['.a.b', { a: { b: 2 } }], ['.a?', [1]], ['.missing', {}], ['.[0], .[-1], .[5]', [1, 2, 3]],
  ['.[1:3], .[:-1], .[2:], .[-2:]', [1, 2, 3, 4]], ['.[1:3]', 'abcdef'], ['.[]', { a: 1, b: 2 }], ['.[] | select(. > 1)', [1, 2, 3]],
  ['.a, .b', { a: 1, b: 2 }], ['[.[] | . * 2]', [1, 2]], ['map(.x) | add', [{ x: 1 }, { x: 2 }]], ['.a // "d"', { a: false }],
  ['(.a, .b) // "d"', { a: null, b: 2 }], ['1 + 2 * 3, 10 / 4, 7 % 3, "a" + "b", [1] + [2], {a: 1} + {b: 2}, null + 1', null],
  ['[1,2,3] - [2], {a: {b: 1}} * {a: {c: 2}}, "a,b" / ","', null], ['.[] as $x | $x * 10', [1, 2]], ['reduce .[] as $x (0; . + $x)', [1, 2, 3]],
  ['[foreach .[] as $x (0; . + $x)]', [1, 2, 3]], ['[foreach .[] as $x (0; . + $x; [$x, .])]', [1, 2]],
  ['if . > 0 then "pos" elif . < 0 then "neg" else "zero" end', -2], ['if . then 1 end', false],
  ['{name, n: (.items | length)}', { name: 'x', items: [1, 2] }], ['{(.k): .v}', { k: 'a', v: 1 }], ['{a: (1,2)}', null],
  ['"\\(.a)-\\(.b)"', { a: 1, b: 'x' }], ['keys, length', { b: 1, a: 2 }], ['keys_unsorted', { b: 1, a: 2 }], ['to_entries', { a: 1 }],
  ['from_entries', [{ key: 'a', value: 1 }, { name: 'b', value: 2 }]], ['with_entries(.value += 1)', { a: 1, b: 2 }],
  ['sort_by(.n) | map(.n)', [{ n: 3 }, { n: 1 }, { n: 2 }]], ['group_by(.t) | map(length)', [{ t: 'a' }, { t: 'b' }, { t: 'a' }]],
  ['unique, min, max, reverse', [3, 1, 3, 2]], ['sort', [{}, [], 'a', 1, true, false, null]], ['min_by(.a), max_by(.a), unique_by(.a)', [{ a: 2 }, { a: 1 }, { a: 2 }]],
  ['.a |= . + 1, .b = 5, .c += 2, .d //= "x"', { a: 1 }], ['.[] |= . * 2', [1, 2]], ['.a.b |= "x"', {}], ['(.a, .b) = 0', {}],
  ['del(.[0])', [1, 2]], ['del(.a)', { a: 1, b: 2 }], ['del(.[] | select(. > 1))', [1, 2, 3]], ['[paths]', { a: [1] }],
  ['join(", "), (map(tostring) | join("-"))', ['a', 'b']], ['join(",")', ['a', 1, null, true]],
  ['split(","), test("b"), startswith("a"), endswith("b"), ascii_upcase, ltrimstr("a,"), rtrimstr(",b")', 'a,b'],
  ['tonumber, tostring', '42'], ['[.[] | tostring]', [1, 'a', null]], ['@csv, @tsv, @sh, @json, @base64, @text', ['a', 1]],
  ['@uri', 'a b&c'], ['@html "<\\(.)>"', '&'], ['def f: . * 2; def g(x): x + 1; f | g(. * 10)', 3], ['def f($a): $a + .; f(2)', 1],
  ['[limit(2; .[])], first(.[]), last(.[]), isempty(empty), nth(1)', [5, 6, 7]], ['[.. | numbers]', { a: [1, { b: 2 }] }],
  ['try error("x") catch ., (.a.b)?', 1], ['.a.b', 1], ['[.[] | select(.ok)] | length', [{ ok: true }, { ok: false }, {}]],
  ['contains(["a"]), inside(["a", "b", "c"])', ['a', 'b']], ['contains("bar"), contains({a: [1]})', 'foobar'], ['has("x"), has("y")', { x: 1 }],
  ['any, all, (map(. > 1) | any)', [1, 2]], ['flatten, flatten(1)', [[1], [2, [3]]]], ['walk(if type == "number" then . + 1 else . end)', [1, { a: 2 }]],
  ['[range(3)], [range(1; 4)]', null], ['indices(1), index(1), rindex(1)', [1, 2, 1]], ['indices(", ")', 'a, b, c'], ['explode | implode', 'héllo'],
  ['tojson, (tojson | fromjson)', { a: [1] }], ['[.[] | type]', [null, true, 1, 'a', [], {}]], ['map(select(type == "string"))', [1, 'a', 'b']],
  ['add', ['a', 'b']], ['add', [[1], [2]]], ['add', []], ['length', null], ['length', -5], ['utf8bytelength', 'é'],
  ['.[] | numbers, strings', [1, 'a']], ['map(floor), map(sqrt)', [4.7, 9]], ['[.[] | . as $x | $x + 1]', [1, 2]],
  ['getpath(["a","b"]), setpath(["a","c"]; 1)', { a: { b: 2 } }], ['to_entries | map("\\(.key)=\\(.value)") | join("&")', { a: 1, b: 'x' }],
  ['1 / 0', null], ['{} | .a.b.c', null], ['"x" * 3', null], ['.[] += 1', { a: 1, b: 2 }], ['first, last', []],
  // Syntax and functions the ones above do not reach.
  ['.a or .b, .a and .b, (.b | not)', { a: true, b: false }], ['{"a b": 1, "k\\(1)": 2} | ."a b", .k1', null], ['[.[]?], .a?', 1],
  ['sort', [{ b: 1 }, { a: 2 }, { a: 1, b: 0 }, { a: 1 }]], ['contains([1]), contains({a: 1})', [1, 2]], ['contains({a: 1})', { a: 1, b: 2 }],
  ['[paths]', [[1], { b: 2 }]], ['to_entries[] | select(.value > 1) | .key', { a: 1, b: 2 }], ['.a[1:]', { a: [1, 2, 3] }],
  ['.[] | (.a // "none")', [{ a: 1 }, {}]], ['[.[] | -(.)]', [1, -2]], ['{a: 1} | has("a"), (keys | contains(["a"]))', null],
];

describe('jq evaluator agrees with jq', function () {
  if (!hasJq) return;
  for (const [filter, input] of pairs) {
    it(`${filter}  ←  ${JSON.stringify(input)}`, () => {
      const mine = runJq(filter, input);
      assert.ok(mine, 'supported');
      const real = realJq(filter, input);
      if (real === 'error') {
        assert.ok('error' in mine, `jq fails, we gave ${JSON.stringify(mine)}`);
        return;
      }
      assert.ok(!('error' in mine), `we failed with ${'error' in mine && mine.error}`);
      assert.deepStrictEqual(mine.outputs.map(toJson), real);
    });
  }
});

describe('jq examples agree with jq', function () {
  if (!hasJq) return;
  const filters: [string, string[]?][] = [
    ['.items[] | select(.ok) | .name'], ['.users | map({name, age: .profile.age}) | sort_by(.age) | .[-1].name', ['-r']],
    ['.config.timeout // 30'], ['.[] | select(.price > 100) | .name'], ['[.[] | .price] | add'], ['keys'], ['.data[2:5]'], ['.x |= tostring'],
    ['if .n > 0 then "pos" else "neg" end'], ['reduce .[] as $x (0; . + $x)'], ['map(select(.status == "active")) | length'],
    ['.[] | "\\(.name) is \\(.age)"', ['-r']], ['to_entries | map("\\(.key)=\\(.value)") | join("&")'],
    ['group_by(.type) | map({type: .[0].type, count: length})'], ['del(.password)'], ['.tags | join(", ")'], ['[.[] | .name] | @csv', ['-r']],
    ['paths'], ['.a.b.c'], ['def double: . * 2; .count | double'], ['.[0]'], ['length'], ['.items | first'], ['with_entries(.value |= tostring)'],
    ['.name // "anonymous"'], ['.users[] | select(.age >= 30) | {name, email}'], ['[.[] | select(.tags | index("sale"))] | length'],
  ];
  for (const [filter, args = []] of filters) {
    it(filter, () => {
      const runs = jqExample(filter, { raw: args.includes('-r') });
      assert.ok(runs, 'has an example');
      for (const r of runs) {
        const real = realJq(filter, r.input, args);
        if (r.error) {
          assert.strictEqual(real, 'error');
          continue;
        }
        assert.deepStrictEqual(r.outputs, real, `input ${JSON.stringify(r.input)}`);
      }
    });
  }
});

describe('jq is available', () => {
  it('runs (otherwise the comparisons above are skipped)', function () {
    if (!hasJq) this.skip();
    assert.match(execFileSync('jq', ['--version']).toString(), /^jq-/);
  });
});
