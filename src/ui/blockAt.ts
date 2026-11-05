// The command over several lines at the cursor, for the editors to mark (VS Code: decorations; the web page: line
// decorations). Pure: the rows come from the syntax tree the explanations read (the one the host already has), in the
// document's rows also for a host file (a Makefile recipe, a workflow `run:`, a Markdown fence, a Dockerfile `RUN`),
// whose tree is that of the shell text row for row.
import type { ShellDocument } from '../document';
import { childrenOnRows, type SyntaxNode } from '../syntax/tree';

/** The rows of a command over several lines (0-based, both included). */
export interface Block {
  startLine: number;
  endLine: number;
}

/** Where a row is in its block: the first, the last, or between. */
export type BlockPlace = 'first' | 'mid' | 'last';

/** The statements that are marked when they take several lines: compound commands, functions, `$( )`, and commands that continue over lines. */
const BLOCKS: ReadonlySet<string> = new Set([
  'for_statement', 'select_statement', 'c_style_for_statement', 'while_statement', 'if_statement', 'case_statement',
  'compound_statement', 'subshell', 'function_definition', 'command_substitution', 'process_substitution', 'pipeline', 'list',
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
 * block, from whichever of its lines the cursor is on.
 */
export function blockAt(doc: ShellDocument, line: number, col: number): Block | undefined {
  const c = shellColumn(doc, line, col);
  const rows = shellRows(doc);
  let found: SyntaxNode | undefined;
  for (let n: SyntaxNode | undefined = doc.tree.root; n;) {
    if (n.endPosition.row > n.startPosition.row && BLOCKS.has(n.type) && !(n.type === 'compound_statement' && n.parent?.type === 'function_definition')) found = n;
    n = childrenOnRows(n.children, line, line).find((k) => k.named && holds(rows, k, line, c));
  }
  if (!found) return undefined;
  // (`a && b || c` is a list of a list: the cursor on `b` is in the inner one, but the command is the whole.)
  while (found.type === 'list' && found.parent?.type === 'list') found = found.parent;
  // An unclosed construct ends at the start of the line after its last (or at the end of the text).
  const endLine = found.endPosition.column === 0 ? found.endPosition.row - 1 : found.endPosition.row;
  return endLine > found.startPosition.row ? { startLine: found.startPosition.row, endLine } : undefined;
}

/** Where `line` is in `block`. */
export function placeOf(block: Block, line: number): BlockPlace {
  return line === block.startLine ? 'first' : line === block.endLine ? 'last' : 'mid';
}

const rowsOf = new WeakMap<object, string[]>();
/** The rows of the shell text (a host file's text is not the document's). */
function shellRows(doc: ShellDocument): string[] {
  let l = rowsOf.get(doc);
  if (!l) rowsOf.set(doc, (l = doc.tree.text.split('\n')));
  return l;
}

/** Whether the position is in `n`; the blanks before its first token and after its last count as in. */
function holds(rows: string[], n: SyntaxNode, row: number, col: number): boolean {
  const a = n.startPosition;
  const b = n.endPosition;
  if (row < a.row || row > b.row) return false;
  if (row === a.row && col < a.column && /\S/.test(rows[a.row].slice(0, a.column))) return false;
  if (row === b.row && col > b.column && /\S/.test(rows[b.row].slice(b.column))) return false;
  return true;
}
