// Where the worked examples say their input comes from (src/examples/source.ts), and whether the real tools, given
// the files and the standard input the example shows, print what it shows.
import * as assert from 'assert';
import { parseJsonValues, varyJson } from '../src/examples/jq';
import { rerun } from '../src/examples/rerun';
import { exampleOf, has, realOutput } from './support/examples';
import { explain } from './support/explain';

const labels = (src: string, lang: 'en' | 'ja' = 'en') => exampleOf(src, lang)?.sections.map((s) => s.label);

describe('the input sections say what the command reads, and where from', () => {
  const cases: [string, string[]][] = [
    ['jq . a.json < b.json', ['Input: `a.json` (sample contents)', 'Output']],
    ['jq . - a.json < b.json', ['Input: stdin (`b.json`, sample contents)', 'Input: `a.json` (sample contents)', 'Output']],
    ['jq . a.json b.json', ['Input: `a.json` (sample contents)', 'Input: `b.json` (sample contents)', 'Output']],
    ['jq . *.json', ['Input: files matching `*.json` (sample contents)', 'Output']],
    ['jq . "$@"', ['Input: the files `"$@"` names (sample contents)', 'Output']],
    ['jq .', ['Input: stdin (sample contents)', 'Output']],
    ['curl -s u | jq .', ['Input: stdin (sample output of the previous command)', 'Output']],
    ["jq .a <<< '{\"a\":5}'", ['Input: stdin (here-string)', 'Output']],
    ['jq .a <<< "$x"', ['Input: stdin (here-string, sample contents)', 'Output']],
    ['jq -n \'{a:1}\'', ['Output']],
    ['jq -n \'{a:1}\' < b.json', ['Output']],
    ["awk 'BEGIN { print 1 }' f", ['Output']],
    ['uniq in.txt out.txt', ['Input: `in.txt` (sample contents)', 'Written to `out.txt`']],
    ['xargs -a list.txt echo', ['Input: `list.txt` (sample contents)', 'Commands that run']],
    ['xargs echo < list.txt', ['Input: stdin (`list.txt`, sample contents)', 'Commands that run']],
    ['sort a b | uniq -c', ['Input: `a` (sample contents)', 'Input: `b` (sample contents)', 'After `sort a b`', 'Output (after `uniq -c`)']],
    ["yq '.a' a.yml b.yml", ['Input: `a.yml` (sample contents)', 'Input: `b.yml` (sample contents)', 'Output (YAML)']],
    ["yq -n '.a = 1'", ['Output (YAML)']],
    ["sed -i 's/a/b/' x y", ['Input: `x` (sample contents)', 'After']],
    ["sed -s '$d' x y", ['Input: `x` (sample contents)', 'Output']],
    ['date +%F', ['When it runs (made up, UTC)', 'Output']],
    ["perl -pi -e 's/a/b/' x y", ['Input: `x` (sample contents)', 'After']],
    ["yq -i '.a' x.yml y.yml", ['Input: `x.yml` (sample contents)', 'Input: `y.yml` (sample contents)', '`x.yml` after']],
    ["yq -i '.a' x.yml", ['Input: `x.yml` (sample contents)', 'After']],
    ["echo '{\"a\":1}' | jq .a", ['Input: stdin (output of the previous command)', 'Output']],
    ["cat <<'E' | jq .a\n{\"a\":1}\nE", ['Input: stdin (output of the previous command)', 'Output']],
    ['cat a - b < c', ['Input: `a` (sample contents)', 'Input: stdin (`c`, sample contents)', 'Input: `b` (sample contents)', 'Output']],
    ['sort a a', ['Input: `a` (sample contents)', 'Output']],
  ];
  for (const [line, want] of cases) it(line, () => assert.deepStrictEqual(labels(line), want));
  it('in Japanese', () => {
    assert.deepStrictEqual(labels('jq . - a.json < b.json', 'ja'), ['入力: 標準入力（`b.json`、中身の例）', '入力: `a.json`（中身の例）', '出力']);
    assert.deepStrictEqual(labels('cat *.log | sort', 'ja')?.[0], '入力: `*.log` に一致するファイル（中身の例）');
    assert.deepStrictEqual(labels('curl -s u | jq .', 'ja')?.[0], '入力: 標準入力（前のコマンドの出力の例）');
    assert.deepStrictEqual(labels('echo 1 | jq .', 'ja')?.[0], '入力: 標準入力（前のコマンドの出力）');
    assert.deepStrictEqual(labels("jq .a <<< '{\"a\":5}'", 'ja')?.[0], '入力: 標準入力（ヒアストリング）');
    assert.deepStrictEqual(labels('jq .a <<E\n{"a":5}\nE', 'ja')?.[0], '入力: 標準入力（ヒアドキュメント）');
    assert.deepStrictEqual(labels('jq .a <<E\n$x\nE', 'ja')?.[0], '入力: 標準入力（ヒアドキュメント、中身の例）');
    assert.deepStrictEqual(labels('jq . "$f"', 'ja')?.[0], '入力: `"$f"` のファイル（中身の例）');
    assert.deepStrictEqual(labels('date +%F', 'ja')?.[0], '実行した時刻（例、UTC）');
  });
  it('says when nothing is read', () => {
    assert.strictEqual(exampleOf("jq -n '{a:1}'")?.note, 'Reads no input (`.` is `null`)');
    assert.strictEqual(exampleOf("awk 'BEGIN { print 1 }'", 'ja')?.note, '入力は読まない（`BEGIN` だけ）');
  });
  it('notes a standard input that a command given files does not read', () => {
    const note = (line: string, lang: 'en' | 'ja' = 'en') => explain(line, 0, lang).notes.find((n) => /stdin|標準入力/.test(n));
    assert.strictEqual(note('jq . a.json < b.json'), 'ℹ `jq` is given a file to read (`a.json`), so it does not read its stdin (`< b.json`); `-` would make it read stdin too');
    assert.strictEqual(note('cat x | sort a', 'ja'), 'ℹ `sort` には読むファイル（`a`）が指定されているので、標準入力（パイプで渡される前のコマンドの出力）は読まない（`-` を指定すると標準入力も読む）');
    assert.match(note('grep x f <<< y')!, /here-string/);
    assert.match(note('grep x f <<E\ny\nE')!, /here-document/);
    for (const line of ['jq . - a.json < b.json', 'jq . < b.json', 'jq . a.json', 'sort a', 'sort -o x < y']) assert.strictEqual(note(line), undefined, line);
  });
  it('gives one editable box per file, which the panel runs again together', () => {
    const it = exampleOf('jq -c . a.json b.json')!.interactive!;
    assert.deepStrictEqual(it.inputs.map((b) => b.label), ['Input: `a.json` (sample contents)', 'Input: `b.json` (sample contents)']);
    assert.deepStrictEqual(rerun(it.spec, [['{"a":1}'], ['{"a":2} 3']], 'en').sections[0].lines, ['{"a":1}', '{"a":2}', '3']);
    const head = exampleOf('head -n 1 a b')!.interactive!;
    assert.deepStrictEqual(rerun(head.spec, [['x', 'y'], ['z']], 'en').sections[0].lines, ['==> a <==', 'x', '', '==> b <==', 'z']);
    const pipe = exampleOf('sort a b | uniq -c')!.interactive!;
    assert.deepStrictEqual(rerun(pipe.spec, [['b', 'a'], ['b']], 'en').sections.pop()!.lines, ['      1 a', '      2 b']);
  });
});

describe('the examples of several files, or of a here-string, agree with the tools', () => {
  const lines: [string, string][] = [
    ['jq', 'jq -c . a.json < b.json'], ['jq', 'jq -c . - a.json < b.json'], ['jq', 'jq -c . a.json b.json'], ['jq', 'jq -c .name a.json b.json'],
    ['jq', "jq -c .a <<< '{\"a\":5}'"], ['jq', 'jq -c .a <<E\n{"a":[1,2]}\nE'], ['jq', 'jq -cs . a.json b.json'], ['jq', 'jq -nc \'{a:1}\''],
    ['sort', 'sort a b'], ['sort', 'sort -r a b c'], ['head', 'head -n 1 a b'], ['tail', 'tail -n 2 a b'], ['head', 'head -q -n 1 a b'], ['head', 'head -v -n 2 a'],
    ['head', 'head -n 1 - a < b'], ['sed', "sed 's/a/X/' a b"], ['sed', "sed -n '$p' a b"], ['sed', "sed 's/l/L/g' <<< hello"], ['sed', "sed 's/a/b/' <<'E'\nabc\naaa\nE"],
    ['gawk', "awk '{ print NR \": \" $0 }' a b"], ['gawk', "awk 'BEGIN { print 1 }' f"], ['gawk', "awk '{ print $2 }' <<< 'x y'"], ['cut', 'cut -d, -f2 a b'],
    ['tr', 'tr a-z A-Z <<< hello'], ['sort', 'sort a b | uniq -c'], ['sort', 'cat a b | sort -r'], ['sort', "sort <<< b | uniq"],
    ['jq', "cat <<'E' | jq -c .a\n{\"a\":[1,2]}\nE"], ['jq', "echo '{\"a\":1}' | jq -c .a"],
    ['sort', "sort <<< $'b\\na'"], ['sort', 'sort a a'], ['jq', 'jq -c . a.json a.json'], ['head', 'head -n 1 a a'], ['jq', 'jq -cs . a b'],
    ['cat', 'cat a - b < c'], ['cat', 'cat a - - < c'], ['cat', 'cat a b'], ['head', 'head -c 5 a b'], ['head', 'head -c -3 a b'], ['head', 'head -q -c 5 a b'], ['tail', 'tail -c 3 a b'], ['head', 'head -c 11 a b'], ['jq', "jq -cs 'map(.a)' a b"], ['sort', "sort 0<<< $'b\\na' | uniq"], ['sort', "cat 0<<'E' | sort\nb\na\nE"],
  ];
  for (const [tool, line] of lines) {
    (has(tool) ? it : it.skip)(line, () => {
      const ex = exampleOf(line)!;
      assert.ok(ex, 'has an example');
      const { got, want } = realOutput(line, ex);
      assert.strictEqual(got, want);
    });
  }
  (has('jq') ? it : it.skip)('reads what the stages before it print, when they are known', () => {
    const line = "printf '%s\\n' '{\"a\":2}' '{\"a\":1}' | sort | jq -c .a";
    const ex = explain(line).examples.find((e) => e.kind === 'jq')!;
    assert.deepStrictEqual(ex.sections.map((s) => s.lines), [['{"a":1}', '{"a":2}'], ['1', '2']]);
    const { got, want } = realOutput(line, ex);
    assert.strictEqual(got, want);
  });
});

describe('the sources of the edge cases', () => {
  it('reads the text a here-string gives to yq, when it is JSON', () => {
    const ex = (line: string) => explain(line).examples.find((e) => e.kind === 'yq');
    assert.deepStrictEqual(ex("yq -o json '.a' <<< '{\"a\":[1]}'")?.sections.map((s) => s.lines), [['{"a":[1]}'], ['[', '  1', ']']]);
    assert.deepStrictEqual(ex("yq -y '.a' <<< '{\"a\":[1]}'")?.sections.map((s) => s.lines), [['{"a":[1]}'], ['- 1']]);
    assert.deepStrictEqual(ex("yq -o json '.a' a.yml b.yml")?.sections.length, 3);
    assert.ok(ex("yq -y '.a' a.yml b.yml"));
    // YAML that is not JSON, JSON that mikefarah/yq prints in flow style, a filter that fails on the value given, or one
    // too long to run: no example.
    for (const line of ["yq '.a' <<< 'a: 1'", "yq -y '.a' <<< 'a: 1'", "yq '.a' <<< '{\"a\":[1]}'", "yq '.a + 1' <<< '{\"a\":\"x\"}'", "yq 'reduce range(.n) as $x (0; . + 1)' <<< '{\"n\":1000000}'"]) assert.strictEqual(ex(line), undefined, line);
  });
  it('knows the standard input of a here-document being typed, and of redirections it cannot name', () => {
    assert.deepStrictEqual(labels('jq . <<'), ['Input: stdin (here-document, sample contents)', 'Output']);
    assert.deepStrictEqual(labels('jq . < "$f"')?.[0], 'Input: stdin (`"$f"`, sample contents)');
    assert.deepStrictEqual(labels('jq . <> f')?.[0], 'Input: stdin (`f`, sample contents)');
    assert.deepStrictEqual(labels('jq . <&3')?.[0], 'Input: stdin (sample contents)');
    assert.deepStrictEqual(labels('jq . 2< f')?.[0], 'Input: stdin (sample contents)');
  });
  it('gives every file a sample of its own, the same each time it is named', () => {
    for (const line of ["sed 's/a/b/' a b", 'jq -s . a b', 'sort a b c d e f g h']) {
      assert.ok(exampleOf(line)!.sections.every((s) => s.lines.length), line);
    }
    const sort = exampleOf('sort a a')!.interactive!;
    assert.deepStrictEqual(sort.inputs.length, 1);
    assert.deepStrictEqual(rerun(sort.spec, [['b', 'a']], 'en').sections[0].lines, ['a', 'a', 'b', 'b']);
    const cat = exampleOf('cat a - - < c')!.interactive!;
    assert.deepStrictEqual(rerun(cat.spec, [['x'], ['y']], 'en').sections[0].lines, ['x', 'y']);
  });
  it('shows cat only when it joins several files, and follows no pipeline that starts with a tool working on each file apart', () => {
    for (const line of ['cat a', 'cat < a', 'cat -n a b']) assert.strictEqual(exampleOf(line), undefined, line);
    for (const line of ['grep x a b | sort', 'wc -l a b | sort -n', 'head -n 1 a b | sort', 'cat a a | sort', "sed -s '$d' a b | sort"]) {
      assert.ok(!explain(line).examples.some((e) => e.kind === 'pipeline'), line);
    }
    assert.ok(explain('cat a b | sort').examples.some((e) => e.kind === 'pipeline'));
    // A here-document to another descriptor is not the input; the commands xargs runs print what is not known.
    assert.ok(!explain('cat 3<<E | sort\nx\nE').examples.some((e) => e.kind === 'pipeline'));
    assert.strictEqual(explain('echo a | xargs echo | jq .').examples.find((e) => e.kind === 'jq')?.sections[0].label, 'Input: stdin (sample output of the previous command)');
  });
  it('gives head and tail of files of a glob no example (how many is not known)', () => {
    for (const line of ['head -n 1 *.log', 'tail -n 1 - *.log']) assert.strictEqual(exampleOf(line), undefined, line);
    assert.deepStrictEqual(exampleOf('head -qn 1 a b')?.sections.pop()?.lines.length, 2);
  });
  it('shows what jq printed before a file it fails on', () => {
    assert.deepStrictEqual(rerun({ kind: 'jq', filter: '. + 1', raw: false, vars: {} }, [['1'], ['"x"']], 'en').sections.map((s) => s.label), ['Output', 'Error']);
    assert.deepStrictEqual(rerun({ kind: 'jq', filter: '. + 1', raw: false, vars: {} }, [['"x"']], 'en').sections.map((s) => s.label), ['Error']);
  });
  it('reads JSON values one after another', () => {
    assert.deepStrictEqual(parseJsonValues('1[2]{"a":"\\"x"}"s" true null'), [1, [2], { a: '"x' }, 's', true, null]);
    assert.deepStrictEqual(varyJson({ a: [1, 'x', true, null] }, 2), { a: [3, 'x3', true, null] });
  });
});
