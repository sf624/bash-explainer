import * as assert from 'assert';
import * as fs from 'fs';
import * as path from 'path';
import type { BashParser as Parser } from '../src/syntax/tree';
import { Analyzer, EXAMPLE_KINDS, ExplainOptions, Token } from '../src/analyzer';
import { parseDirectives, suppressed } from '../src/directives';
import { createUnbashParser } from '../src/syntax/adapters/unbash';
import { pruneDepth } from '../src/ui/render';

const root = path.join(__dirname, '..');
let parser: Parser;
before(async () => {
  parser = createUnbashParser();
});
const explain = (src: string, opts: ExplainOptions = {}, line = 0) => {
  const tree = parser.parse(src);
  const ex = new Analyzer('en').explainLine(tree, line, undefined, opts);
  return ex;
};
const all = (ts: Token[]): Token[] => ts.flatMap((t) => [t, ...all(t.children)]);

describe('example settings', () => {
  it('gives every example of the sample script a kind', () => {
    const src = fs.readFileSync(path.join(root, 'test/fixtures/sample.sh'), 'utf8');
    const tree = parser.parse(src);
    const a = new Analyzer('en');
    const seen = new Set<string>();
    src.split('\n').forEach((_, i) => a.explainLine(tree, i).examples.forEach((e) => {
      assert.ok(e.kind && EXAMPLE_KINDS.includes(e.kind), `line ${i + 1}: ${e.title}`);
      seen.add(e.kind);
    }));
    assert.deepStrictEqual([...seen].sort(), [...EXAMPLE_KINDS].sort());
  });
  it('turns examples off altogether or by kind', () => {
    const src = "grep -E '^v[0-9]+' tags.txt | sort -u";
    assert.ok(explain(src).examples.length > 0);
    assert.deepStrictEqual(explain(src, { examples: { enabled: false, disabled: [] } }).examples, []);
    const kinds = (o: ExplainOptions) => explain("echo \"${f%.*}\"; grep -E '^v[0-9]+' t", o).examples.map((e) => e.kind);
    assert.deepStrictEqual(kinds({}), ['expansion', 'regex']);
    assert.deepStrictEqual(kinds({ examples: { enabled: true, disabled: ['regex'] } }), ['expansion']);
  });
});

describe('idiom notes', () => {
  it('can be turned off', () => {
    assert.ok(explain('set -euo pipefail').notes.some((n) => /strict mode/i.test(n)));
    assert.ok(!explain('set -euo pipefail', { idioms: false }).notes.some((n) => /strict mode/i.test(n)));
  });
});

describe('custom commands', () => {
  const customCommands = {
    deploy: { summary: 'Deploy to production', options: { '-n|--dry-run': 'only show what would happen', '-e': { description: 'environment', takesValue: true } }, arguments: ['service name'] },
    broken: { options: { '-x': 'no summary' } },
  };
  it('explains a command described in the setting', () => {
    const ex = explain('deploy -n -e prod web', { customCommands });
    const toks = all(ex.items).map((t) => `${t.label}: ${t.explanation}`);
    assert.match(toks[0], /^deploy: Deploy to production \(from the customCommands setting\)/);
    assert.ok(toks.includes('-n: only show what would happen'));
    assert.ok(toks.includes('-e: environment') && toks.includes('prod: Value for `-e`'), toks.join('\n'));
    assert.ok(toks.includes('web: service name'));
  });
  it('also inside sudo, and ignores malformed entries', () => {
    assert.match(all(explain('sudo deploy web', { customCommands }).items).map((t) => t.explanation).join('\n'), /Deploy to production/);
    assert.match(explain('broken -x', { customCommands }).items[0].explanation, /not in the dictionary/);
  });
});

describe('disable comments', () => {
  it('apply to the next line, the same line or the whole file', () => {
    const d = parseDirectives([
      '#!/bin/sh',
      '# bash-explainer disable=dbracket',
      '',
      '[[ -f a ]]',
      'echo -e x  # bash-explainer disable=echoE,local',
      '[[ -f b ]]',
      '# bash-explainer disable-file=injection',
    ]);
    assert.ok(suppressed(d, 3, 'dbracket'));
    assert.ok(!suppressed(d, 5, 'dbracket'));
    assert.ok(suppressed(d, 4, 'echoE') && suppressed(d, 4, 'local'));
    assert.ok(suppressed(d, 0, 'injection') && suppressed(d, 99, 'injection'));
    assert.ok(suppressed(parseDirectives(['# bash-explainer disable=all', 'x']), 1, 'anything'));
    assert.ok(suppressed(parseDirectives(['<!-- bash-explainer disable-file=dbracket -->']), 7, 'dbracket'));
  });
  it('are explained', () => {
    assert.match(explain('# bash-explainer disable=dbracket,echoE').items[0].explanation, /no `dbracket`, `echoE` warnings on the next line/);
  });
});

describe('hover depth', () => {
  it('keeps the given number of levels', () => {
    const items = explain("grep -E '^v[0-9]+' tags.txt").items;
    const depth = (ts: Token[]): number => (ts.length ? 1 + Math.max(...ts.map((t) => depth(t.children))) : 0);
    assert.ok(depth(items) > 3);
    assert.strictEqual(depth(pruneDepth(items, 2)), 2);
    assert.strictEqual(depth(pruneDepth(items, 0)), depth(items));
  });
});
