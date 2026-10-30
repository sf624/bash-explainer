// The shell code the syntax tests work on (fixtures and snippets of the tests), and the invariants of the model's trees.
import * as fs from 'fs';
import * as path from 'path';
import { extractShell, hostKind } from '../../src/hosts';
import type { SyntaxNode, SyntaxTree } from '../../src/syntax/tree';

const root = path.join(__dirname, '../..');

export interface Input { name: string; text: string }

/** The shell code of the fixtures and the snippets from the tests (test/fixtures/snippets.json, see scripts/extract-snippets.ts). */
export function corpus(): { files: Input[]; snippets: Input[] } {
  const fixtures = path.join(root, 'test/fixtures');
  const read = (...p: string[]): string => fs.readFileSync(path.join(fixtures, ...p), 'utf8');
  const files: Input[] = ['sample.sh', 'coverage.sh', 'posix.sh', 'ksh.ksh'].map((f) => ({ name: f, text: read(f) }));
  for (const f of fs.readdirSync(path.join(fixtures, 'hosts')).sort()) {
    const kind = hostKind('', f);
    if (kind) files.push({ name: `hosts/${f}`, text: extractShell(kind, read('hosts', f)).text });
  }
  const snippets = (JSON.parse(read('snippets.json')) as string[]).map((text, i) => ({ name: `snippet ${i}: ${JSON.stringify(text).slice(0, 60)}`, text }));
  return { files, snippets };
}

/** Whether a node is a here-document's body or its closing line: text that comes after the rest of its line. */
const isHole = (n: SyntaxNode): boolean => n.type === 'heredoc_body' || n.type === 'heredoc_end';

/**
 * Breaks of the model's invariants in a tree (an empty list for a sound tree): the checks that do not need a
 * second parser. Children lie inside their parent, in order and without overlaps, with one exception: a
 * `heredoc_redirect` ends with its body, which comes after the rest of its line, so the nodes of that line
 * (`| cmd`, `; cmd`, arguments, other redirections) lie inside its range without being its children. For
 * those, the text each leaf covers is what counts: the leaves outside the bodies, in tree order, are in
 * text order and do not overlap, and the bodies are in text order and hold no other leaf.
 */
export function invariants(tree: SyntaxTree): string[] {
  const bad: string[] = [];
  const text = tree.text;
  const rows = (i: number): { row: number; column: number } => {
    const before = text.slice(0, i);
    const row = before.split('\n').length - 1;
    return { row, column: i - (before.lastIndexOf('\n') + 1) };
  };
  const hasHole = (n: SyntaxNode): boolean => isHole(n) || n.children.some(hasHole);
  const visible: SyntaxNode[] = [];
  const holes: SyntaxNode[] = [];
  const visit = (n: SyntaxNode, parent: SyntaxNode | null, path: string, inHole: boolean): void => {
    const here = `${path}/${n.type}@${n.startIndex}`;
    if (n.parent !== parent) bad.push(`${here}: parent`);
    if (n.text !== text.slice(n.startIndex, n.endIndex)) bad.push(`${here}: text`);
    if (n.endIndex < n.startIndex) bad.push(`${here}: negative width`);
    const s = rows(n.startIndex);
    const e = rows(n.endIndex);
    if (n.startPosition.row !== s.row || n.startPosition.column !== s.column || n.endPosition.row !== e.row || n.endPosition.column !== e.column) bad.push(`${here}: position`);
    const named = n.children.filter((c) => c.named);
    if (named.length !== n.namedChildren.length || named.some((c, i) => c !== n.namedChildren[i])) bad.push(`${here}: namedChildren`);
    if (parent && (n.startIndex < parent.startIndex || n.endIndex > parent.endIndex)) bad.push(`${here}: outside its parent [${parent.startIndex},${parent.endIndex}]`);
    const hole = inHole || isHole(n);
    if (!n.children.length) (hole ? holes : visible).push(n);
    let at = n.startIndex;
    let prevHole = false;
    for (const c of n.children) {
      // (Where a here-document is involved, the leaves are checked as a whole, below.)
      const involved = prevHole || hasHole(c);
      if (c.startIndex < at && !involved) bad.push(`${here}: ${c.type}@${c.startIndex} overlaps or is out of order`);
      if (!involved) at = Math.max(at, c.endIndex);
      prevHole ||= hasHole(c);
      // (A line continuation that splits a token is removed before it is read: `&\<newline>&` is `&&`.)
      if (!c.named && c.type !== c.text.replace(/\\\n/g, '')) bad.push(`${here}: token ${c.type} has text ${c.text}`);
      visit(c, n, here, hole);
    }
  };
  visit(tree.root, null, '', false);
  for (const leaves of [visible, holes]) {
    leaves.forEach((l, i) => {
      if (i && l.startIndex < leaves[i - 1].endIndex) bad.push(`leaf ${l.type}@${l.startIndex} overlaps or is out of order`);
    });
  }
  for (const h of holes) {
    const hit = visible.find((v) => v.startIndex < h.endIndex && v.endIndex > h.startIndex && v.endIndex > v.startIndex && h.endIndex > h.startIndex);
    if (hit) bad.push(`leaf ${hit.type}@${hit.startIndex} is in a here-document`);
  }
  return bad;
}
