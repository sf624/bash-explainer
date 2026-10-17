import * as assert from 'assert';
import * as path from 'path';
import type { BashParser as Parser } from '../src/parser';
import { Analyzer, Token } from '../src/analyzer';
import { describeFind, parseFind } from '../src/embedded/find';
import { createBashParser } from '../src/parser';

const arity = (w: string) => (w === '-exec' ? 'until' as const : ['-name', '-path', '-type', '-mtime', '-newer', '-maxdepth'].includes(w) ? 1 : 0);

let parser: Parser;
before(async () => {
  const root = path.join(__dirname, '..');
  parser = await createBashParser({
    runtimeDir: path.join(root, 'node_modules/web-tree-sitter'),
    bashWasm: path.join(root, 'node_modules/tree-sitter-bash/tree-sitter-bash.wasm'),
  });
});

function tokens(src: string, lang: 'ja' | 'en' = 'en'): Token[] {
  const tree = parser.parse(src);
  const ex = new Analyzer(lang).explainLine(tree, 0);
  tree.delete();
  const all = (ts: Token[]): Token[] => ts.flatMap((t) => [t, ...all(t.children)]);
  return all(ex.items);
}

describe('find expressions', () => {
  it('parses with -o binding looser than the implicit -a', () => {
    const tree = parseFind('-name a -o -name b -type f'.split(' '), arity)!;
    assert.strictEqual(tree.type, 'or');
    assert.deepStrictEqual(tree.type === 'or' && tree.children.map((c) => c.type), ['primary', 'and']);
  });

  it('describes conditions, groups, negation and the implicit -print', () => {
    const w = '( -name *.log -o -name *.tmp ) -mtime +7'.split(' ');
    assert.strictEqual(describeFind(parseFind(w, arity)!, 'en'),
      'Print what matches: (name matches *.log; or name matches *.tmp) and modified more than 7 days ago (no action is given, so `-print` is implied)');
    assert.match(describeFind(parseFind('! -newer ref'.split(' '), arity)!, 'en'), /not \(newer than ref\)/);
  });

  it('reads actions after conditions and spots the -prune idiom', () => {
    const d = describeFind(parseFind('-path ./node_modules -prune -o -type f -print'.split(' '), arity)!, 'en');
    assert.match(d, /^Conditions and actions: if path matches \.\/node_modules: skip it without descending; or if a regular file: print it/);
    assert.match(d, /usual way to exclude a directory/);
    assert.match(describeFind(parseFind('-name *.gz -exec rm {} +'.split(' '), arity)!, 'en'), /run "rm \{\}" on all at once/);
  });

  it('rejects incomplete expressions', () => {
    assert.strictEqual(parseFind('-name x -o'.split(' '), arity), undefined);
    assert.strictEqual(parseFind('( -name x'.split(' '), arity), undefined);
  });
});

describe('find in a command line', () => {
  it('wraps the expression in one token with grouping, operators and primaries inside', () => {
    const ts = tokens("find . \\( -name '*.log' -o -name '*.tmp' \\) -mtime +7");
    const expr = ts.find((t) => t.kind === 'test')!;
    assert.match(expr.explanation, /^Print what matches: \(name matches \*\.log; or name matches \*\.tmp\)/);
    assert.ok(ts.some((t) => t.kind === 'block' && /^Group/.test(t.explanation)));
    assert.match(ts.find((t) => t.label === '-o')!.explanation, /lower precedence than `-a`/);
    assert.match(ts.find((t) => t.label === "'*.log'" && t.kind === 'argument')!.explanation, /pattern: any string \+ "\.log"/);
    assert.match(ts.find((t) => t.label === '.')!.explanation, /starting directory/);
  });

  it('explains {} in -exec', () => {
    const ts = tokens('find . -name x -exec rm {} \;');
    assert.match(ts.find((t) => t.label === '{}')!.explanation, /replaced with the path/);
  });

  it('falls back to per-option explanations when the expression is incomplete', () => {
    const ts = tokens('find . -name x -o');
    assert.ok(!ts.some((t) => t.kind === 'test'));
    assert.ok(ts.some((t) => t.label === '-name'));
  });
});
