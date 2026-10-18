import * as assert from 'assert';
import * as path from 'path';
import { Analyzer, LineExplanation, Token } from '../src/analyzer';
import type { BashParser as Parser } from '../src/parser';
import { createBashParser } from '../src/parser';

// patches/tree-sitter-bash/grammar.patch: `=~` binds tighter than `&&`/`||`, and `${s:$i}` has a variable offset.
const root = path.join(__dirname, '..');
let parser: Parser;

before(async () => {
  parser = await createBashParser({
    runtimeDir: path.join(root, 'node_modules/web-tree-sitter'),
    bashWasm: path.join(root, 'grammar/tree-sitter-bash.wasm'),
  });
});

function sexp(src: string): string {
  const tree = parser.parse(src);
  try {
    return tree.rootNode.toString();
  } finally {
    tree.delete();
  }
}

function explain(src: string): LineExplanation {
  const tree = parser.parse(src);
  try {
    return new Analyzer('en').explainLine(tree, 0);
  } finally {
    tree.delete();
  }
}

function all(tokens: Token[]): Token[] {
  return tokens.flatMap((t) => [t, ...all(t.children)]);
}

function find(e: LineExplanation, label: string, kind?: Token['kind']): Token {
  const t = all(e.items).find((x) => x.label === label && (!kind || x.kind === kind));
  assert.ok(t, `no token "${label}" in: ${all(e.items).map((x) => x.label).join(', ')}`);
  return t;
}

describe('patched tree-sitter-bash grammar', () => {
  it('binds =~ tighter than && and ||', () => {
    for (const src of ['[[ -f a && $x =~ re ]]', '[[ $x =~ re && -f a ]]', '[[ $x =~ re || $y =~ re2 ]]']) {
      const s = sexp(src);
      assert.ok(!s.includes('ERROR') && !s.includes('MISSING'), `${src}: ${s}`);
    }
    // The && is the root of the test; each side is one operand.
    assert.match(sexp('[[ -f a && $x =~ re ]]'), /binary_expression left: \(unary_expression[^]*\) right: \(binary_expression left: \(simple_expansion[^]*\) right: \(word\)\)/);
    assert.match(sexp('[[ $x =~ re && -f a ]]'), /binary_expression left: \(binary_expression left: \(simple_expansion[^]*\) right: \(word\)\) right: \(unary_expression/);
  });

  it('explains a regex match mixed with &&', () => {
    const e = explain('[[ -f a && $x =~ re ]]');
    assert.match(find(e, '$x =~ re').explanation, /regex/);
    assert.match(find(e, '-f a && $x =~ re').explanation, /both conditions/);
    assert.match(find(explain('[[ $x =~ ^a && -f b ]]'), '$x =~ ^a').explanation, /regex/);
  });

  it('reads a variable as the offset of ${s:$i}', () => {
    for (const src of ['echo ${s:$i}', 'echo ${s:$i:2}', 'echo ${s:$i:$n}']) {
      const s = sexp(src);
      assert.ok(!s.includes('MISSING') && !s.includes('ERROR'), `${src}: ${s}`);
      assert.match(s, /expansion/);
    }
    assert.match(find(explain('echo ${s:$i:2}'), '${s:$i:2}', 'expansion').explanation, /take a substring of `s` \(offset `\$i`, length `2`\)/);
  });
});
