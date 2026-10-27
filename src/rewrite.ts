// The rewrites a fact suggests, as data (docs/design/oracles.md, 3.2): the note renders its suggestion from them, and a
// test applies them and runs both scripts in bash (test/rewrites.test.ts). Quick fixes can come from the same data.
import { STATEMENTS } from './semantics/env';
import { documentRoot } from './semantics/state';
import { descendants, type SyntaxNode } from './syntax/tree';

/** A change to the text explained (the document): the text from `start` to `end` (offsets, `end` exclusive) becomes `text`. */
export interface TextEdit { start: number; end: number; text: string }

/**
 * One rewrite a fact suggests, complete in itself: its edits, applied together, and the code the note shows for it
 * (`code`: what the edits add or put in place, as the user would type it). A fact's rewrites are alternatives, the
 * first the one it recommends (`Fact.rewrite`). In a string another command reads as a script (`bash -c '…'`), where
 * the code would need quoting, a rewrite has no edits: the note shows its code, and the fact does not carry it. The
 * facts of a host file (a Dockerfile, a workflow, a Makefile) carry no rewrites: the edits are in the extracted text,
 * not the file (src/hosts/remap.ts).
 */
export interface Rewrite { code: string; edits: readonly TextEdit[] }

/** The root of the tree `n` is in, and whether that tree is the document's (not a string read as a script). */
function treeOf(n: SyntaxNode): { root: SyntaxNode; own: boolean } {
  let root = n;
  while (root.parent) root = root.parent;
  return { root, own: documentRoot(n) === root };
}

/**
 * The rewrite that puts `code` in place of node `n`. Not as edits when `n` holds a here-document: its body is in the
 * text of `n`, and the code would put it before what follows (`{ echo x <<EOF⏎body⏎EOF; exit 1; }` is not closed).
 */
export function replaceNode(n: SyntaxNode, code: string): Rewrite {
  const edits = treeOf(n).own && !descendants(n, ['heredoc_redirect']).length;
  return { code, edits: edits ? [{ start: n.startIndex, end: n.endIndex, text: code }] : [] };
}

/**
 * The rewrite that puts the statement `code` before the statement `n`: on a line of its own, indented as `n` is, when
 * `n` starts its line (`do\n  rm "$f"`); else followed by `; ` (`do rm "$f"`, `then for …`).
 */
export function statementBefore(n: SyntaxNode, code: string): Rewrite {
  const { root, own } = treeOf(n);
  // (The root's text starts at its first token: what is before it on that line is blanks.)
  const at = n.startIndex - root.startIndex;
  const before = root.text.slice(root.text.lastIndexOf('\n', at - 1) + 1, at);
  const text = /^[ \t]*$/.test(before) ? code + '\n' + before : `${code}; `;
  return {
    code,
    edits: own ? [{ start: n.startIndex, end: n.startIndex, text }] : [],
  };
}

/** The text of the document from the start of `first` to the end of `last` (nodes of one tree, `first` before `last`). */
export function textBetween(first: SyntaxNode, last: SyntaxNode): string {
  const { root } = treeOf(first);
  return root.text.slice(first.startIndex - root.startIndex, last.endIndex - root.startIndex);
}

/** The rewrite that puts `code` in place of the text from `start` to `end` (offsets in the tree of `n`, a node of it). */
export function replaceRange(n: SyntaxNode, start: number, end: number, code: string): Rewrite {
  return { code, edits: treeOf(n).own ? [{ start, end, text: code }] : [] };
}

/** A name for a variable the rewrite adds, that the document does not use: `base`, else `base2`, `base3`… */
export function unusedName(n: SyntaxNode, base: string): string {
  const text = documentRoot(n).text;
  for (let i = 1; ; i++) {
    const name = i === 1 ? base : `${base}${i}`;
    if (!new RegExp(`(?<!\\w)${name}(?!\\w)`).test(text)) return name;
  }

/** The operators that join the statements of a list or a pipeline. */
const JOINS: ReadonlySet<string> = new Set(['&&', '||', '|', '|&']);

/**
 * The end of `n` before the bodies of its here-documents: where the line it starts on goes on (`cat <<EOF; }`). Left
 * out too: the comments, and in a list or a pipeline what is neither a statement nor an operator: the tree puts there
 * the tokens that follow a here-document on its line (the `; }` of `{ a && cat <<EOF; }`).
 */
function headEnd(n: SyntaxNode): number {
  const joined = n.type === 'list' || n.type === 'pipeline';
  let end = n.children.length ? n.startIndex : n.endIndex;
  for (const c of n.children) {
    if (c.type === 'heredoc_body' || c.type === 'heredoc_end' || c.type === 'comment' || (joined && !STATEMENTS.has(c.type) && !JOINS.has(c.type))) continue;
    end = Math.max(end, headEnd(c));
  }
  return end;
}

/** The text of node `n` with `changes` made (edits within it, in offsets of the text explained). */
export function changed(n: SyntaxNode, changes: readonly TextEdit[]): string {
  return [...changes].sort((a, b) => b.start - a.start).reduce((t, c) => t.slice(0, c.start - n.startIndex) + c.text + t.slice(c.end - n.startIndex), n.text);
}

/**
 * The rewrite that puts the statement `code` after the statement `n`: when only blanks or a comment follow `n` on its
 * line (`  [ -f x ] && echo y  # c`), on a line of its own after that one (or after its here-documents), indented as
 * the line `n` starts on; else after `; ` (`f() { [ -f x ] && echo y; }`, `f() { a && cat <<EOF; }`).
 */
export function statementAfter(n: SyntaxNode, code: string): Rewrite {
  const { root, own } = treeOf(n);
  const text = root.text;
  const lineEnd = (at: number): number => { const e = text.indexOf('\n', at - root.startIndex); return root.startIndex + (e < 0 ? text.length : e); };
  const head = headEnd(n);
  if (!/^[ \t]*(#.*)?$/.test(text.slice(head - root.startIndex, lineEnd(head) - root.startIndex))) return { code, edits: own ? [{ start: head, end: head, text: `; ${code}` }] : [] };
  const at = lineEnd(n.endIndex);
  const indent = /^[ \t]*/.exec(text.slice(text.lastIndexOf('\n', n.startIndex - root.startIndex - 1) + 1))![0];
  return { code, edits: own ? [{ start: at, end: at, text: '\n' + indent + code }] : [] };
}

/**
 * The list `a && b` as `if a; then b; fi`, whose status is 0 when `a` fails (`n`: a list whose last operator is
 * `&&`). `fi` goes before the bodies of here-documents, which follow the line.
 */
export function asIf(n: SyntaxNode): Rewrite {
  const and = n.children.find((c) => c.type === '&&')!;
  const right = n.namedChildren.find((c) => c.startIndex >= and.endIndex && c.type !== 'comment')!;
  const blanks = /[ \t]*$/.exec(n.text.slice(0, and.startIndex - n.startIndex))![0].length;
  return replaceNode(n, changed(n, [{ start: n.startIndex, end: n.startIndex, text: 'if ' }, { start: and.startIndex - blanks, end: and.endIndex, text: '; then' },
    { start: headEnd(right), end: headEnd(right), text: '; fi' }]));
}

/** Where a statement put in place of another would not stand as one: `x | b`, `! x`, `time x`. */
const BOUND: ReadonlySet<string> = new Set(['pipeline', 'negated_command', 'time_statement', 'coproc_statement', 'redirected_statement']);

/**
 * `code`, a list of statements, as one statement in place of the statement `n`: as it is where `n` stands alone or
 * first in an `&&` or `||` list (`local x; x=$(f) || return`); else in a group (`a && { local x; x=$(f); }`).
 */
export function inPlaceOf(n: SyntaxNode, code: string): string {
  const p = n.parent!;
  return BOUND.has(p.type) || (p.type === 'list' && p.namedChildren[0] !== n) ? `{ ${code}; }` : code;
}
