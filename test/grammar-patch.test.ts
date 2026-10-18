import * as assert from 'assert';
import * as path from 'path';
import { Analyzer, LineExplanation, Token } from '../src/analyzer';
import type { Node } from 'web-tree-sitter';
import type { BashParser as Parser } from '../src/parser';
import { createBashParser } from '../src/parser';

// patches/tree-sitter-bash/grammar.patch: `=`, `==` and `=~` in `[[ ]]` bind tighter than `&&`/`||`, and `${s:$i+1}` has a variable in its offset.
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

// The tree with operators: binary_expression is `(left op right)`, other nodes are their text (or `name[children]`).
function shape(src: string): string {
  const tree = parser.parse(src);
  try {
    const walk = (n: Node): string => {
      if (n.type === 'binary_expression') {
        const op = n.childForFieldName('operator')?.text ?? '?';
        return `(${walk(n.childForFieldName('left')!)} ${op} ${walk(n.childForFieldName('right')!)})`;
      }
      if (n.type === 'ERROR' || n.isMissing) return 'ERROR';
      if (['program', 'test_command', 'compound_statement', 'parenthesized_expression', 'expansion'].includes(n.type)) {
        return `${n.type}[${n.namedChildren.map(walk).join(' ')}]`;
      }
      return n.text;
    };
    return walk(tree.rootNode);
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
    assert.equal(shape('[[ $x =~ re || $y =~ re2 ]]'), 'program[test_command[(($x =~ re) || ($y =~ re2))]]');
  });

  it('binds = and == tighter than && and ||, in both orders', () => {
    for (const op of ['=', '==']) {
      assert.equal(shape(`[[ -f a && $x ${op} y ]]`), `program[test_command[(-f a && ($x ${op} y))]]`);
      assert.equal(shape(`[[ $x ${op} y && -f a ]]`), `program[test_command[(($x ${op} y) && -f a)]]`);
      assert.equal(shape(`[[ $x ${op} y || $z ${op} w ]]`), `program[test_command[(($x ${op} y) || ($z ${op} w))]]`);
    }
    // rsync-ssl's option check
    assert.equal(shape('[[ "$1" = --help || "$1" = -h ]]'), 'program[test_command[(("$1" = --help) || ("$1" = -h))]]');
  });

  it('leaves assignments and the other test forms as they were', () => {
    assert.equal(shape('x=1'), 'program[x=1]');
    assert.equal(shape('(( x = y && z ))'), 'program[compound_statement[(x = (y && z))]]');
    assert.equal(shape('[[ ( $x =~ re ) ]]'), 'program[test_command[parenthesized_expression[($x =~ re)]]]');
    assert.equal(shape('[[ $x =~ ^(a|b)$ && -n $y ]]'), 'program[test_command[(($x =~ ^(a|b)$) && -n $y)]]');
  });

  it('reads a variable followed by + or - in an offset', () => {
    for (const src of ['echo ${s:$i+1}', 'echo ${s:$i-1:1}', 'echo "${words[@]:$sc_start+1:${#words[@]}-$sc_start-1}"']) {
      const s = sexp(src);
      assert.ok(!s.includes('MISSING') && !s.includes('ERROR'), `${src}: ${s}`);
    }
    assert.match(sexp('echo ${s:$i+1}'), /expansion \(variable_name\) \(binary_expression \(simple_expansion \(variable_name\)\) \(number\)\)/);
    assert.match(sexp('echo ${s:$i-1:1}'), /\(binary_expression \(simple_expansion \(variable_name\)\) \(number\)\) \(number\)/);
    assert.match(find(explain('echo "${words[@]:$sc_start+1:${#words[@]}-$sc_start-1}"'), '${words[@]:$sc_start+1:${#words[@]}-$sc_start-1}', 'expansion').explanation, /of the elements of array `words` from index `\$sc_start\+1`/);
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
