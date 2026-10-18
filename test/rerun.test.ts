import * as assert from 'assert';
import * as path from 'path';
import type { BashParser as Parser } from '../src/syntax/tree';
import { Analyzer } from '../src/analyzer';
import { matchMarks, rerun } from '../src/examples/rerun';
import { toJsRegex } from '../src/examples/regex';
import { createTreeSitterParser } from '../src/syntax/adapters/tree-sitter';
import { quickReference } from '../src/ui/reference';
import { toPlainMarkdown } from '../src/ui/render';

const root = path.join(__dirname, '..');
let parser: Parser;
before(async () => {
  parser = await createTreeSitterParser({
    runtimeDir: path.join(root, 'node_modules/web-tree-sitter'),
    bashWasm: path.join(root, 'grammar/tree-sitter-bash.wasm'),
  });
});
const explain = (src: string) => {
  const tree = parser.parse(src);
  const ex = new Analyzer('en').explainLine(tree, 0);
  return ex;
};

describe('editable examples', () => {
  it('marks matches and capture groups', () => {
    const re = toJsRegex('([0-9]{4})-([0-9]{2})', 'ere')!;
    assert.deepStrictEqual(matchMarks(re, 'on 2026-10 and 1999-01'), [
      { start: 3, end: 10, group: 0 }, { start: 3, end: 7, group: 1 }, { start: 8, end: 10, group: 2 },
      { start: 15, end: 22, group: 0 }, { start: 15, end: 19, group: 1 }, { start: 20, end: 22, group: 2 },
    ]);
  });
  it('reruns grep on the user\'s lines, listing what the groups capture', () => {
    const ex = explain("grep -E '^v([0-9]+)\\.([0-9]+)' tags.txt").examples[0];
    const r = rerun(ex.interactive!.spec, ['v1.2', 'x', 'v10.20 beta'], 'en');
    assert.deepStrictEqual(r.sections[0].lines, ['v1.2', 'v10.20 beta']);
    assert.deepStrictEqual(r.sections[1].lines, ['line 1: "v1.2"  \\1="1"  \\2="2"', 'line 3: "v10.20"  \\1="10"  \\2="20"']);
    assert.deepStrictEqual(r.marks![1], []);
  });
  it('reruns sed, awk, jq, sort and pipelines, and highlights what s/// matches', () => {
    const sed = explain("sed -E 's/([a-z]+)@/\\1 at /' in.txt").examples[0].interactive!;
    const r = rerun(sed.spec, ['bob@example.com'], 'en');
    assert.deepStrictEqual(r.sections[0].lines, ['bob at example.com']);
    assert.deepStrictEqual(r.marks![0].map((m) => m.group), [0, 1]);
    assert.deepStrictEqual(rerun(explain("awk '{ print $2 }' f").examples[0].interactive!.spec, ['a b', 'c d'], 'en').sections[0].lines, ['b', 'd']);
    assert.deepStrictEqual(rerun(explain("jq '.a' f.json").examples[0].interactive!.spec, ['{"a": [1]}'], 'en').sections[0].lines, ['[1]']);
    assert.match(rerun(explain("jq '.a' f.json").examples[0].interactive!.spec, ['{oops'], 'en').sections[0].lines[0], /not valid JSON/);
    assert.deepStrictEqual(rerun(explain('sort -rn nums.txt').examples[0].interactive!.spec, ['2', '10', '1'], 'en').sections[0].lines, ['10', '2', '1']);
    const pipe = explain('grep a f.txt | sort | uniq -c').examples.find((e) => e.interactive?.spec.kind === 'pipeline')!;
    assert.deepStrictEqual(rerun(pipe.interactive!.spec, ['ab', 'ca', 'ab', 'x'], 'en').sections.pop()!.lines, ['      2 ab', '      1 ca']);
  });
  it('keeps examples of data the command makes itself read-only', () => {
    assert.strictEqual(explain('seq 3 | sort -r').examples[0].interactive, undefined);
  });
});

describe('copy as Markdown', () => {
  it('writes the tree and examples without HTML', () => {
    const md = toPlainMarkdown(explain('sort -u names.txt'), 'sort -u names.txt', 'a.sh:3');
    assert.match(md, /^\*\*a\.sh:3\*\*\n\n```bash\nsort -u names\.txt\n```/);
    assert.match(md, /\n- `sort -u names\.txt` — Sort lines/);
    assert.match(md, /\n  - `-u` — /);
    assert.ok(!/<span|<code/.test(md));
  });
});

describe('quick reference', () => {
  it('covers expansions, redirections, tests and commands', () => {
    const ref = quickReference('en');
    const find = (syntax: string) => ref.find((e) => e.syntax === syntax);
    assert.ok(find('${var:-word}'));
    assert.ok(find('2>&1'));
    assert.ok(find('[ -f x ]'));
    assert.ok(find('grep'));
    assert.ok(ref.length > 150);
  });
});
