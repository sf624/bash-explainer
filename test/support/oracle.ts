// The oracle of the syntax adapters: compares two trees of the model node for node. The tree-sitter
// adapter is the reference; the unbash adapter must give the same tree wherever tree-sitter reads the
// script correctly (test/syntax-adapter-unbash.test.ts).
import * as fs from 'fs';
import * as path from 'path';
import { extractShell, hostKind } from '../../src/hosts';
import type { SyntaxNode, SyntaxTree } from '../../src/syntax/tree';

const root = path.join(__dirname, '../..');

/** Where the two nodes first differ, or undefined if the trees under them are the same. */
export function diffNodes(a: SyntaxNode, b: SyntaxNode, where = ''): string | undefined {
  const here = `${where}/${a.named ? a.type : JSON.stringify(a.type)}@${a.startIndex}`;
  const props = ['type', 'named', 'text', 'startIndex', 'endIndex', 'field', 'incomplete'] as const;
  for (const p of props) if (a[p] !== b[p]) return `${here}: ${p} ${JSON.stringify(a[p])} != ${JSON.stringify(b[p])}`;
  for (const p of ['startPosition', 'endPosition'] as const) {
    if (a[p].row !== b[p].row || a[p].column !== b[p].column) return `${here}: ${p} ${JSON.stringify(a[p])} != ${JSON.stringify(b[p])}`;
  }
  const n = Math.min(a.children.length, b.children.length);
  for (let i = 0; i < n; i++) {
    const d = diffNodes(a.children[i], b.children[i], here);
    if (d) return d;
  }
  if (a.children.length !== b.children.length) {
    const show = (c: SyntaxNode | undefined): string => (c ? `${c.type}[${c.startIndex},${c.endIndex}]` : 'none');
    return `${here}: ${a.children.length} children != ${b.children.length} (next: ${show(a.children[n])} != ${show(b.children[n])})`;
  }
  return undefined;
}

/** Compares the trees' errors as well as the nodes. */
export function diffTrees(a: SyntaxTree, b: SyntaxTree): string | undefined {
  const d = diffNodes(a.root, b.root);
  if (d) return d;
  const errs = (t: SyntaxTree): string => JSON.stringify(t.errors.map((e) => [e.kind, e.startIndex, e.endIndex]));
  return errs(a) === errs(b) ? undefined : `errors ${errs(a)} != ${errs(b)}`;
}

/** The top-level statements (the named children of the program, comments left out) that are the same in both trees. */
export function topLevel(a: SyntaxTree, b: SyntaxTree): { identical: number; total: number; first?: string } {
  const named = (t: SyntaxTree): SyntaxNode[] => t.root.namedChildren.filter((c) => c.type !== 'comment');
  const others = new Map(named(b).map((c) => [`${c.type}@${c.startIndex}`, c]));
  let identical = 0;
  let first: string | undefined;
  for (const c of named(a)) {
    const o = others.get(`${c.type}@${c.startIndex}`);
    const d = o ? diffNodes(c, o) : `${c.type}@${c.startIndex}: no such statement`;
    if (d) first ??= d;
    else identical++;
  }
  return { identical, total: named(a).length, first };
}

/** A model tree as indented lines: type, field, range and, for a leaf, its text. */
export function dumpModel(n: SyntaxNode, depth = 0): string {
  const head = `${'  '.repeat(depth)}${n.named ? n.type : JSON.stringify(n.type)}${n.field ? ' @' + n.field : ''}${n.incomplete ? ' INCOMPLETE' : ''} [${n.startIndex},${n.endIndex}]`;
  return head + (n.children.length ? '' : ' ' + JSON.stringify(n.text)) + '\n' + n.children.map((c) => dumpModel(c, depth + 1)).join('');
}

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

/** Breaks of the model's invariants in a tree (an empty list for a sound tree): the checks that do not need a second parser. */
export function invariants(tree: SyntaxTree): string[] {
  const bad: string[] = [];
  const text = tree.text;
  const rows = (i: number): { row: number; column: number } => {
    const before = text.slice(0, i);
    const row = before.split('\n').length - 1;
    return { row, column: i - (before.lastIndexOf('\n') + 1) };
  };
  const visit = (n: SyntaxNode, parent: SyntaxNode | null, path: string): void => {
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
    let at = n.startIndex;
    for (const c of n.children) {
      // (Two heredocs on a line: the second one's operator is before the first one's body, and its body after.)
      const beside = c.type === 'heredoc_redirect' && n.children.some((d) => d !== c && d.type === 'heredoc_redirect');
      if (c.startIndex < at && !beside) bad.push(`${here}: ${c.type}@${c.startIndex} overlaps or is out of order`);
      at = Math.max(at, c.endIndex);
      if (!c.named && c.type !== c.text) bad.push(`${here}: token ${c.type} has text ${c.text}`);
      visit(c, n, here);
    }
  };
  visit(tree.root, null, '');
  return bad;
}
