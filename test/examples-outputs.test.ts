// The outputs of the worked examples, compared with the real tools given the files and the standard input the
// examples show: jq's pretty printing and its options, mikefarah/yq's formats, awk's FILENAME, a file written.
import * as assert from 'assert';
import { spawnSync } from 'child_process';
import * as fs from 'fs';
import * as path from 'path';
import { jqPrint } from '../src/examples/jq';
import { exampleOf, has, realOutput } from './support/examples';

/**
 * mikefarah/yq (MIT; a Go program, used as a separate program): `$BASH_EXPLAINER_YQ4`, or a `yq` on PATH that says it
 * is mikefarah's, or the newest `yq-4.*` in `$BASH_EXPLAINER_YQ` (test/yq.test.ts). CI installs a pinned release
 * (.github/actions/install-tools). Undefined when there is none: the comparisons are skipped.
 */
export function mikefarahYq(): string | undefined {
  const says = (bin: string) => /mikefarah/.test(spawnSync(bin, ['--version']).stdout?.toString() ?? '');
  const env = process.env.BASH_EXPLAINER_YQ4;
  if (env) return env;
  const onPath = spawnSync('bash', ['-c', 'command -v yq']).stdout.toString().trim();
  if (onPath && says(onPath)) return onPath;
  const dir = process.env.BASH_EXPLAINER_YQ;
  const newest = dir && fs.existsSync(dir) ? fs.readdirSync(dir).filter((f) => /^yq-4\./.test(f)).sort((a, b) => a.localeCompare(b, undefined, { numeric: true })).pop() : undefined;
  return newest && path.join(dir!, newest);
}

const compare = (tool: string | undefined, lines: string[], bin: Record<string, string> = {}) => {
  for (const line of lines) {
    (tool ? it : it.skip)(line, () => {
      const ex = exampleOf(line);
      assert.ok(ex, 'has an example');
      const { got, want } = realOutput(line, ex!, bin);
      assert.strictEqual(got, want);
    });
  }
};

describe('jq examples print as jq does', () => {
  compare(has('jq') ? 'jq' : undefined, [
    // Two spaces a level by default; one line with -c; a tab, another indent, the keys in order.
    'jq . a.json', 'jq .users a.json', "jq '.items[] | select(.price > 10)' a.json", 'jq -c . a.json', 'jq --tab . a.json', 'jq --indent 3 . a.json',
    'jq --indent 0 . a.json', 'jq --indent 1 -c . a.json', 'jq -c --indent 1 . a.json', 'jq -S . a.json', 'jq . a.json b.json', 'jq . a.json < b.json',
    "jq '.users | map(.age)' u.json", "jq -r '.name' a.json", "jq -j '.[]' a.json", "jq -r '.' a.json", 'jq -s . a.json b.json',
    // -R reads lines as strings; -n with input and inputs reads the files through the filter.
    'jq -R . f.txt', 'jq -Rs . f.txt', "jq -R 'split(\",\")' f.csv", "jq -R 'length' a b", "jq -n '[inputs]' a.json b.json", "jq -n 'input' a.json b.json",
    "jq -n '[inputs | .name]' a.json b.json", "jq '[., input]' a.json", "jq -n '{a:1}'", "jq -nc '[1,2]'", "jq '.a' <<< '{\"a\":{\"b\":1}}'",
    "jq -S '.items' a.json", "jq -n '[inputs]' a.json a.json", 'jq -n input < b.json', "jq -n '[inputs]' - a.json < b.json",
  ]);
  it('sorts the keys of objects inside arrays too (-S)', () => {
    assert.deepStrictEqual(jqPrint([{ b: 1, a: [{ d: 1, c: 2 }] }], { indent: 0, sortKeys: true }), ['[{"a":[{"c":2,"d":1}],"b":1}]']);
  });
  it('gives no example for an indent jq refuses or one not known, nor for a filter that cannot run here', () => {
    for (const line of ['jq --indent 9 . a.json', 'jq --indent "$n" . a.json', "jq -R 'select' f", "jq -s 'now' a.json b.json", "yq -y -n '[inputs]' a.yml", "jq -n '[input, input]' a.json"]) {
      assert.strictEqual(exampleOf(line), undefined, line);
    }
  });
});

describe('mikefarah/yq examples print as yq does', () => {
  const yq = mikefarahYq();
  compare(yq, [
    "yq -o json '.' f.yml", "yq '.' f.json", "yq '.users | map(.name)' f.json", "yq -o json -I 4 '.' f.yml", "yq -o json -I 0 '.' f.yml",
    "yq -o yaml '.' f.json", "yq -p json '.' < f.json", "yq '.a' a.yml b.yml", "yq -o json '.' a.yml b.yml", "yq '.' f.yml",
    "yq -o json '.a' <<< '{\"a\":[1]}'", "yq -n '.a = 1'", "yq -o json '.name' f.yml", "yq '.items[] | select(.price > 10) | .name' f.json",
    // -r prints a string bare, also in JSON; -r=false turns it off.
    "yq -r '.name' f.json", "yq -o json -r '.name' f.yml", "yq -r=false '.name' f.json", "yq -o json -r=false '.name' f.yml", "yq --unwrapScalar '.name' f.json",
    "yq -r '.name' f.yml",
  ], yq ? { yq } : {});
  it('gives no example for a format it does not follow', () => {
    for (const line of ["yq '.' f.xml", "yq -p csv '.' f", "yq -o xml '.' f.yml", "yq -I 4 '.' f.yml"]) assert.strictEqual(exampleOf(line), undefined, line);
  });
});

describe('awk examples name the file they read', () => {
  compare(has('gawk') ? 'gawk' : undefined, [
    "awk '{ print FILENAME, FNR, NR }' a b", "awk 'FNR == 1 { print FILENAME }' a b c", "awk '{ print FILENAME }'", "awk 'END { print FILENAME, NR }' a b",
    "awk '{ print FILENAME \": \" $0 }' - a < b", "awk '{ print FILENAME, FNR, NR }' a a", "awk '{ print FILENAME, NR }' a - - < b",
  ]);
  it('gives no example of FILENAME for the files of a glob', () => assert.strictEqual(exampleOf("awk '{ print FILENAME }' *.log"), undefined));
});

describe('a command that writes its output to a file shows what the file gets', () => {
  compare(has('uniq') ? 'uniq' : undefined, ['uniq a out.txt', 'uniq -c a out.txt', 'sort -o out.txt a b', 'sort -r -o out.txt a', 'uniq - out.txt < c', 'sort -o out.txt a a']);
  it('gives a pipeline that writes to a file no example of the whole', () => assert.deepStrictEqual(exampleOf('cat a | sort -o out.txt')?.sections.map((s) => s.label), ['Input: stdin (sample output of the previous command)', 'Written to `out.txt`']));
});
