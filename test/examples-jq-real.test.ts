import * as assert from 'assert';
import { run } from './support/run';
import { execFileSync, spawnSync } from 'child_process';
import { Json, jqExample, runJq, toJson } from '../src/examples/jq';

/** Outputs of the real jq (compact), or an error marker. */
function realJq(filter: string, input: Json, args: string[] = []): string[] | 'error' {
  const r = run('jq', ['-c', ...args, filter], { input: JSON.stringify(input) });
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
  ['error', 'x'], ['length', true], ['length', 'héllo'], ['keys', [5, 6]], ['keys', 1], ['[.[] | values]', [null, 1]], ['has(0), has(5)', [1]], ['has(0)', {}],
  ['.[] | in({"a": 1})', ['a', 'b']], ['.[] | in([1, 2])', [0, 5]], ['map_values(. + 1)', [1, 2]], ['map_values(. + 1)', { a: 1 }], ['any(. > 1), all(. > 0)', [1, 2]],
  ['map(ceil), map(round), map(fabs), map(abs)', [1.2, -2.5]], ['tonumber', 5], ['tonumber', 'x'], ['min, max', []], ['min_by(.a)', []], ['reverse', null],
  ['[recurse]', [1, [2]]], ['[recurse(.[]?)]', [1]], ['to_entries', 1], ['from_entries', [1]],
  ['with_entries(.)', 1],
  ['ascii_downcase', 'AbC'], ['ltrimstr(1), rtrimstr(1)', 'a1'], ['ltrimstr("a")', 5], ['test("A"; "i"), test("a"; "x")', 'abc'],
  ['fromjson', '{'], ['indices(1)', null], ['indices(1)', 5], ['index(", ")', 'a'], ['[.[] | objects, arrays, booleans, nulls, iterables, scalars]', [{}, [], true, null, 1]],
  ['join(",")', [[1]]], ['.a.b = 1', 5], ['.[0] = 1', {}], ['.a', [1]], ['.["a"]', [1]], ['.[0]', { a: 1 }], ['.[{}]', [1]], ['.[] ', 5], ['.[]?', 5],
  ['.[1:]', null], ['.[1:]', 5], ['del(.[-1])', [1, 2]],
  ['del(.a)', 5], ['del(.[0])', null], ['.a += 1', { a: null }], ['.a //= 2, .b //= 3', { a: 1, b: false }],
  ['-.', 'x'], ['. != 1, . <= 1, . >= 1, . > 1', 1], ['{(1): 2}', null], ['{"a": 1} - {"a": 1}', null], ['[] - 1', null], ['{} * 2', null], ['"a" / 0', null], ['"a" % 2', null],
  ['10 % 0', null], ['5 % -2, -5 % 2', null], ['null - 1', null], ['"a" - "b"', null], ['{} + []', null], ['4 / 2, "a,b" / ","', null], ['[1] * 2', null],
  ['@base64d', 'YWJj'], ['@sh', [1, 'a b']], ['@sh', { a: 1 }], ['@csv', [[1]]], ['@tsv', ['a\tb', null, true]], ['@csv', [null, true, 1.5]], ['@json "x\(.)"', [1]],
  ['@text, @html', [1]], ['[.[] | select(. == empty)]', [1]], ['[first(.[]), first(empty)]', [1]], ['getpath(["a", 0])', { a: [5] }],
  ['getpath(["a"])', [1]], ['[limit(0; .[])]', [1]], ['nth(5)', [1]], ['try error catch .', 'e'],
  ['try (1, error("x"), 3) catch .', null], ['(.a, .b) |= 1', {}], ['$__loc__', null],
  ['.. |= (if type == "number" then . + 1 else . end)', [1, [2]]], ['to_entries | from_entries', { a: 1 }],
  ['unique', [{ a: 1 }, { a: 1 }]], ['1 + null, 5 - 2', null], ['false and error, true or error', null], ['.[0]', null],
  ['@base64d', 1], ['@csv', 'a'], ['(if .x then .a else .b end) |= 1', { x: true }], ['del(.. | select(. == 1))', [1, [1, 2]]], ['(first(.a, .b)) |= 1', {}],
  ['(.[]?) |= 1', null], ['.[] |= 1', 1], ['(.a?) |= 2', 1], ['.[-1] |= 9', [1, 2]], ['setpath([-1]; 9), setpath([3]; 9)', [1, 2]], ['setpath(["a"]; 1)', 1], ['setpath([0]; 1)', null], ['setpath(["a"]; 1)', null],
  ['del(.a), del(.[0])', null], ['del(.[0])', {}], ['del(.a)', [1]], ['[.[] | in([1])]', ['a']],
  ['add', 5], ['split(1)', 'a'], ['ltrimstr(1)', 'a'], ['tostring', [1]], ['[.[] | tostring]', [true, null]], ['to_entries', null],
  ['1 - -2', null], ['"\\((1 + (2)))"', null], ['"a\\"b\\(1)"', null], ['1 as $x | {$x}', null], ['{if: 1, and: 2}', null], ['{"a"}', { a: 1 }],
  ['{a: (.b | . + 1)}', { b: 1 }], ['[.[] | try error("x")]', [1]], ['try error({a: 1}) catch .', null], ['error({a: 1})', null],
  ['(if .x then .a end) |= 1', { x: true }], ['(if .x then .a elif .y then .b else .c end) |= 1', { y: true }], ['.[-5] |= 1', [1]], ['.a.b |= 1', null],
  ['any', 5], ['indices([1, 2])', [1, 2, 1, 2]], ['sort', 5],
  ['[- -1]', null], ['(recurse | select(type == "number")) |= . + 1', [1, [2]]], ['(if .x then .a end) |= 1', { x: false }], ['(empty) |= 1', null], ['map_values(.)', 5],
  ['(error("x")) // 1', null], ['(1, error("x")) // 3', null], ['.a |= 1', 5], ['[.[] | (.a // "none")]', [{ a: 1 }, {}]],
  ['(if .x then .a else .b end) |= 1', { x: false }], ['getpath([0])', {}], ['del(.a.b)', { a: null }],
  ['del(.)', { a: 1 }],
  ['[.[] | tostring]', [{ a: 1 }]], ['tojson', 'a"b'], ['"\(1 + 2)"', null],
  // The `x` flag ignores whitespace and comments in the pattern; index and indices on other types.
  ['test("v a"; "x"), test("va"; "x"), test("v #c\\n a"; "x"), test("[ ]a"; "x"), test("a\\\\ b"; "x")', 'va'], ['test("v a"; "x"), test("[ ]a"; "x"), test("a\\\\ b"; "x")', 'v a'],
  ['index("b"), indices("b")', { a: 'b' }], ['indices(1)', { a: 1 }], ['index(1)', true], ['indices("b")', true], ['indices("b")', 3], ['indices("")', 'abc'], ['index(""), rindex("")', 'abc'],
  ['indices(1)', 'abc'], ['fromjson', 5], ['fromjson', { a: 1 }], ['fromjson', 'nan'], ['fromjson', 'abc'], ['fromjson', '[1,'],
  // Destructuring, `?//` and label/break.
  ['.[] as [$a, $b] | $a + $b', [[1, 2], [3, 4]]], ['.[] as [$a, [$b]] | [$a, $b]', [[1, [2]], [3, [4]]]], ['. as [$a, $b] | [$b, $a]', [1]],
  ['. as {a: $x, b: [$y]} | [$x, $y]', { a: 1, b: [2] }], ['. as {$a, $b} | [$a, $b]', { a: 1 }], ['. as {"a": $x} | $x', { a: 5 }],
  ['. as {("a", "b"): $x} | $x', { a: 1, b: 2 }], ['. as {a: $x, $a} | [$x, $a]', { a: 1 }], ['. as [$a] | $a', null], ['. as {a: $x} | $x', null],
  ['. as [$a] | $a', { a: 1 }], ['. as {a: $x} | $x', [1]], ['. as {$a: [$b]} | [$a, $b]', { a: [3] }],
  ['. as {if: $x} | $x', { if: 1 }], ['. as {$a} ?// [$a] | $a', [7]], ['. as {(1): $x} | $x', {}], ['. as {a: {b: $x}, $c} | [$x, $c]', { a: { b: 1 }, c: 2 }],
  ['reduce .[] as [$a, $b] (0; . + $a * $b)', [[1, 2], [3, 4]]], ['[foreach .[] as {n: $n} (0; . + $n; [., $n])]', [{ n: 1 }, { n: 2 }]],
  ['.[] as [$a] ?// $a | [$a]', [[1], 2]], ['[.[] as [$a] ?// $a | $a]', [[3], 4]], ['. as [$a] ?// $b | [$a, $b]', [1]], ['. as {a: $a} ?// [$a] | $a', [7]],
  ['label $out | .[] | if . > 2 then ., break $out else . end', [1, 2, 3, 4]], ['[label $f | .[] | ., (select(. == 2) | break $f)]', [1, 2, 3]],
  ['[.[] | label $x | (., break $x)]', [1, 2]], ['label $a | label $b | 1, break $a, 2', null], ['try (label $a | break $a) catch "caught"', null],
  ['[label $a | (1, 2) | ., (select(. == 1) | break $a)]', null],
  ['break $x', null],
  ['map(type)', [0, -0]], ['.[] | numbers', [1.5]], ['ltrimstr("x")', null],
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
    ['.[-2]'], ['{} | .[]'], ['map(select(.active == true))'], ['.total + 1, 1 + .total'], ['if .ok then .name end'], ['.[1:.n]'], ['(.[0] | .x), map_values(.)'],
    ['.[] | @csv', ['-r']], ['.[] | @tsv', ['-r']], ['.[] | @sh', ['-r']], ['contains("a")'], ['contains(["a"])'], ['. + [1]'], ['. - [1]'], ['. + {"a": 1}'], ['inside("abc")'], ['index(",")'], ['indices(1)'],
    ['. as [$a, $b] | $a'], ['.[] as {name: $n} | $n'], ['label $out | .[] | ., break $out'],
    ['map(select(.n > 0))'], ['.tags[] | ascii_upcase'], ['.foo | ascii_downcase'], ['select(.x == true) | .x'], ['.[7], .[0]'], ['.[0].items[0]'], ['.enabled'], ['ascii_downcase'],
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

(hasJq ? describe : describe.skip)('jq examples with -s and -j agree with jq', () => {
  const filters: [string, string[]][] = [['length', ['-s']], ['map(.age)', ['-s']], ['.[0]', ['-s']], ['add', ['-s']], ['.[]', ['-j']], ['.name', ['-j']], ['.[] | .name', ['-s', '-j']]];
  for (const [filter, args] of filters) {
    it(`${args.join(' ')} ${filter}`, () => {
      const slurp = args.includes('-s');
      const join = args.includes('-j');
      const runs = jqExample(filter, { slurp, join });
      assert.ok(runs, 'has an example');
      for (const r of runs) {
        // The file holds the values of the array, one per line, when slurped.
        const file = slurp ? (r.input as Json[]).map((v) => JSON.stringify(v)).join('\n') : JSON.stringify(r.input);
        const real = spawnSync('jq', ['-c', ...args, filter], { input: file }).stdout.toString();
        if (r.error) continue;
        assert.strictEqual(join ? r.outputs.join('') : r.outputs.join('\n') + (r.outputs.length ? '\n' : ''), join ? real : real.replace(/\n(?=\n|$)/g, '\n'), `file ${file}`);
      }
    });
  }
});

(hasJq ? describe : describe.skip)('jq steps agree with jq', () => {
  const filters: [string, string[]?][] = [
    ['.items[] | select(.price > 10) | .name'], ['.users | map(.age) | add / length', ['-r']], ['.[] | select(.ok) | .name', ['-r']],
    ['.items | map(.name) | sort | unique | length'], ['to_entries | map(.key) | join(",")'], ['.tags | length | . * 2'],
    ['.[] | {name, n: (.tags | length)} | .n'], ['keys | .[] | ascii_upcase'], ['.data[2:5] | map(. * 2) | add'],
  ];
  for (const [filter, args = []] of filters) {
    it(filter, () => {
      const [r] = jqExample(filter, { raw: args.includes('-r') })!;
      assert.ok(r.steps, 'has steps');
      let values = [r.input];
      for (const step of r.steps!) {
        const real = values.map((v) => realJq(step.text, v));
        assert.ok(real.every((x) => x !== 'error'));
        values = step.values;
        assert.deepStrictEqual(values.map(toJson), (real as string[][]).flat(), step.text);
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

describe('jq builtins that need their argument', () => {
  // jq does not define `select/0` (a compile error): no example, and nothing thrown.
  for (const f of ['.[] | select', 'map', 'sort_by', 'del', '.a | contains', 'index']) {
    it(f, function () {
      assert.strictEqual(jqExample(f), undefined);
      if (!hasJq) return this.skip();
      assert.strictEqual(realJq(f, [{ a: 1 }]), 'error');
    });
  }
});
