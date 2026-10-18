import * as assert from 'assert';
import { ancestor, descendants, field, fields, hasError, SyntaxNode, token } from '../src/syntax/tree';

// A hand-built tree for `if x; then ls -l; fi`, on one line: the helpers only read the properties.
type Spec = { type: string; named?: boolean; field?: SyntaxNode['field']; from: number; to: number; row?: number; incomplete?: boolean; children?: Spec[] };
const TEXT = 'if x; then ls -l; fi';
function build(s: Spec, parent: SyntaxNode | null = null): SyntaxNode {
  const row = s.row ?? 0;
  const n = {
    type: s.type, named: s.named ?? true, text: TEXT.slice(s.from, s.to), startIndex: s.from, endIndex: s.to,
    startPosition: { row, column: s.from }, endPosition: { row, column: s.to }, parent, field: s.field ?? null,
    incomplete: s.incomplete ?? false, children: [] as SyntaxNode[], namedChildren: [] as SyntaxNode[],
  };
  n.children = (s.children ?? []).map((c) => build(c, n));
  n.namedChildren = n.children.filter((c) => c.named);
  return n;
}
const tok = (type: string, from: number): Spec => ({ type, named: false, from, to: from + type.length });
const root = build({ type: 'program', from: 0, to: 20, children: [{ type: 'if_statement', from: 0, to: 20, children: [
  tok('if', 0),
  { type: 'command', field: 'condition', from: 3, to: 4, children: [{ type: 'command_name', field: 'name', from: 3, to: 4 }] },
  tok(';', 4), tok('then', 6),
  { type: 'command', from: 11, to: 16, children: [
    { type: 'command_name', field: 'name', from: 11, to: 13 },
    { type: 'word', field: 'argument', from: 14, to: 16 },
  ] },
  tok(';', 16), tok('fi', 18),
] }] });

describe('syntax tree helpers', () => {
  const ifs = root.children[0];
  const ls = ifs.namedChildren[1];

  it('finds children by field and tokens by text', () => {
    assert.equal(field(ifs, 'condition')?.text, 'x');
    assert.equal(field(ifs, 'body'), undefined);
    assert.deepEqual(fields(ls, 'argument').map((n) => n.text), ['-l']);
    assert.equal(token(ifs, 'then')?.startIndex, 6);
    assert.equal(token(ifs, 'else'), undefined);
  });

  it('walks up to an ancestor', () => {
    assert.equal(ancestor(ls.children[1], (a) => a.type === 'if_statement'), ifs);
    assert.equal(ancestor(ls, (a) => a.type === 'while_statement'), undefined);
  });

  it('collects descendants in source order, optionally only on some lines', () => {
    assert.deepEqual(descendants(root, ['command_name']).map((n) => n.text), ['x', 'ls']);
    assert.deepEqual(descendants(root, ['program']).map((n) => n.type), ['program']);
    assert.deepEqual(descendants(root, ['word'], { from: 0, to: 0 }).map((n) => n.text), ['-l']);
    assert.deepEqual(descendants(root, ['word'], { from: 1, to: 3 }), []);
  });

  it('tells whether a subtree has an error', () => {
    assert.equal(hasError(root), false);
    assert.equal(hasError(build({ type: 'program', from: 0, to: 2, children: [{ type: 'error', from: 0, to: 2 }] })), true);
    assert.equal(hasError(build({ type: 'if_statement', from: 0, to: 4, incomplete: true })), true);
  });
});
