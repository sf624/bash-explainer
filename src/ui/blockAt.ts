// The command over several lines at the cursor, for the editors to mark (VS Code: decorations; the web page: line
// decorations). Pure: the rows come from the syntax tree the explanations read (the one the host already has), in the
// document's rows also for a host file (a Makefile recipe, a workflow `run:`, a Markdown fence, a Dockerfile `RUN`),
// whose tree is that of the shell text row for row.
import type { ShellDocument } from '../document';
import { BODY_STATEMENTS, effEndRow } from '../explain/nodes';
import { regionAt, scriptTree, shellStart } from '../hosts/scripts';
import { childrenOnRows, type SyntaxNode, type SyntaxTree } from '../syntax/tree';

/** The rows of a command over several lines (0-based, both included). */
export interface Block {
  startLine: number;
  endLine: number;
}

/** Where a row is in its block: the first, the last, or between. */
export type BlockPlace = 'first' | 'mid' | 'last';

/**
 * The statements that are marked when they take several lines: the compound commands and functions the explanations
 * treat as bodies (`BODY_STATEMENTS`), `[[ ]]`, `$( )`, and the commands that continue over lines.
 */
export const BLOCK_TYPES: ReadonlySet<string> = new Set<string>([
  ...BODY_STATEMENTS, 'extended_test', 'command_substitution', 'process_substitution', 'pipeline', 'list',
  'command', 'redirected_statement', 'negated_command', 'time_statement', 'coproc_statement',
]);

/** The column of the shell text that is the document's column `col` on `line` (a host file maps its columns, every row of it). */
function shellColumn(doc: ShellDocument, line: number, col: number): number {
  if (!doc.extracted) return col;
  const map = doc.extracted.maps[line];
  const at = map.findIndex((c) => c >= col);
  return at < 0 ? map.length - 1 : at;
}

/**
 * The innermost command over several lines that holds the position (line and column of the document, 0-based), or
 * undefined: the cursor is on a command of one line outside any block, on a line that is not shell code, or the block
 * has a single row. A command of one line inside a block gives that block. A chain of `&&` and `||` over lines is one
 * block, from whichever of its lines the cursor is on. In a host file the tree is the one the panel reads for the line
 * (`scriptTree`: the shell that runs its part), and a block stays in that part.
 */
export function blockAt(doc: ShellDocument, line: number, col: number): Block | undefined {
  let tree: SyntaxTree = doc.tree;
  let end = Infinity;
  let from = 0;
  if (doc.extracted) {
    const region = regionAt(doc.extracted, line);
    if (!region) return undefined;
    tree = scriptTree(doc.tree, doc.extracted, region);
    end = region.end;
    from = shellStart(doc.extracted, region, line);
  }
  const c = shellColumn(doc, line, col);
  const rows = shellRows(tree);
  let found: SyntaxNode | undefined;
  for (let n: SyntaxNode | undefined = tree.root; n;) {
    if (effEndRow(n) > n.startPosition.row && BLOCK_TYPES.has(n.type) && !(n.type === 'compound_statement' && n.parent?.type === 'function_definition')) found = n;
    n = childrenOnRows(n.children, line, line).find((k) => k.named && holds(rows, k, line, c));
  }
  if (!found) return undefined;
  // (`a && b || c` is a list of a list: the cursor on `b` is in the inner one, but the command is the whole.)
  while (found.type === 'list' && found.parent?.type === 'list') found = found.parent;
  // (A block that starts before the part the shell reads on its own, or goes on past it, is one the file's other text made: it stops at the part's end.)
  const endLine = Math.min(effEndRow(found), end);
  return found.startPosition.row >= from && endLine > found.startPosition.row ? { startLine: found.startPosition.row, endLine } : undefined;
}

/** Where `line` is in `block`. */
export function placeOf(block: Block, line: number): BlockPlace {
  return line === block.startLine ? 'first' : line === block.endLine ? 'last' : 'mid';
}

const rowsOf = new WeakMap<SyntaxTree, string[]>();
/** The rows of the shell text (a host file's text is not the document's). */
function shellRows(tree: SyntaxTree): string[] {
  let l = rowsOf.get(tree);
  if (!l) rowsOf.set(tree, (l = tree.text.split('\n')));
  return l;
}

/** Whether the position is in `n`; the blanks before its first token, and after its last (a comment too), count as in. */
function holds(rows: string[], n: SyntaxNode, row: number, col: number): boolean {
  const a = n.startPosition;
  const b = n.endPosition;
  if (row < a.row || row > b.row) return false;
  if (row === a.row && col < a.column && /\S/.test(rows[a.row].slice(0, a.column))) return false;
  if (row === b.row && col > b.column && !/^\s*(#.*)?$/.test(rows[b.row].slice(b.column))) return false;
  return true;
}
