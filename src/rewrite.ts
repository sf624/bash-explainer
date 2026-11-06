// The rewrites a fact suggests, as data (docs/design/oracles.md, 3.2): the note renders its suggestion from them, and a
// test applies them and runs both scripts in bash (test/rewrites.test.ts). Quick fixes can come from the same data.
import type { Shell } from './dialect';
import { builtins } from './dict/builtins';
import { leastOf, mostOf } from './lists';
import type { Fact } from './messages';
import { readAs, STATEMENTS } from './semantics/env';
import { documentRoot, type StateModel } from './semantics/state';
import { ancestor, descendants, type SyntaxNode } from './syntax/tree';

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
export interface Rewrite {
  code: string; edits: readonly TextEdit[];
  /**
   * It stops with `return 1 2>/dev/null || exit 1` (`EITHER_STOP`, from `stopCommand`), in a file that may be sourced or
   * run: the panel's fix says why both are there.
   */
  sourcedOrRun?: true;
}

/** Where an edit of a rewrite put its text in the text rewritten: offsets, `to` exclusive. */
export interface Changed { from: number; to: number }

/**
 * `text` with the edits made (offsets in the document; `at`: the offset where `text` starts in it), and where each
 * edit's text went. Edits at one offset go in the reverse of their order (the last given first). The one applier of
 * edits: the rewrites built from a node's text (`changed`), the style checks' (src/pitfalls.ts), the panel's fix
 * (`fixedLines`) and the tests read it.
 */
function splice(text: string, edits: readonly TextEdit[], at: number): { text: string; changed: Changed[] } {
  const order = edits.map((e, i) => ({ e, i })).sort((x, y) => x.e.start - y.e.start || y.i - x.i);
  let out = '';
  let pos = 0;
  const changed: Changed[] = [];
  for (const { e } of order) {
    out += text.slice(pos, e.start - at);
    changed.push({ from: out.length, to: out.length + e.text.length });
    out += e.text;
    pos = e.end - at;
  }
  return { text: out + text.slice(pos), changed };
}

/** `text` with the edits of `r` made: offsets in the document, and `at` the one where `text` starts (the document's start by default). */
export function applyRewrite(text: string, r: Pick<Rewrite, 'edits'>, at = 0): string {
  return splice(text, r.edits, at).text;
}

/** A fix as the panel shows it: the whole lines it is about with its edits made, and where its edits put their text (`text` offsets). */
export interface FixedLines { text: string; changed: readonly Changed[] }

/**
 * The lines of the document `text` that the edits of `r` touch, and the lines `first` to `last` (0-based: the
 * statement the fix is for, which may begin before them, `a \⏎ || b`), with the edits made, and where each edit put
 * its text (none where it only deletes). A carriage return a line ends with is left out where the tree masks it as a
 * space (`masked`: offsets, `SyntaxTree.carriageReturns`). Undefined for a rewrite with no edits.
 */
export function fixedLines(text: string, r: Pick<Rewrite, 'edits'>, first: number, last: number, masked: readonly number[] = []): FixedLines | undefined {
  if (!r.edits.length) return undefined;
  let start = leastOf(r.edits.map((e) => e.start));
  let end = mostOf(r.edits.map((e) => e.end));
  // (The start of line `first` and the end of line `last`.)
  for (let i = 0, from = 0; i <= last; i++) {
    const to = text.indexOf('\n', from);
    if (i === first) start = Math.min(start, from);
    if (i === last) end = Math.max(end, to < 0 ? text.length : to);
    if (to < 0) break;
    from = to + 1;
  }
  start = text.lastIndexOf('\n', start - 1) + 1;
  const next = text.indexOf('\n', end);
  end = next < 0 ? text.length : next;
  if (masked.includes(end - 1)) end--;
  const { text: fixed, changed } = splice(text.slice(start, end), r.edits, start);
  return { text: fixed, changed: changed.filter((c) => c.to > c.from) };
}

/**
 * `f` with the edits of the other facts of `all` that have its text added to its rewrites: a fact said twice on a line
 * is listed once (src/analyzer.ts), and is about two places, `cp $a b; cp $a c`, which its rewrites then both change.
 * A rewrite must change every place, or it leaves the note: where one place has none (in a string another shell
 * reads, `bash -c 'cp $a b'`), the fact has none; the alternatives are paired by their code, and the fact keeps only
 * those every place has (none, where they have none in common). The panel's box merges the places of a note so too
 * (its anchors, src/ui/panelProblems.ts).
 */
export function withRewritesOf<T extends Pick<Fact, 'text' | 'rewrite'>>(f: T, all: readonly T[]): T {
  const same = all.filter((g) => g.text === f.text);
  if (!f.rewrite || same.length < 2) return f;
  const kept = same.some((g) => !g.rewrite) ? [] : f.rewrite.filter((r) => same.every((g) => g.rewrite!.some((o) => o.code === r.code))).map((r) => {
    // (The same edit once: a fact said twice for one place.)
    const edits = new Map(same.flatMap((g) => g.rewrite!.filter((o) => o.code === r.code).flatMap((o) => o.edits)).map((e) => [`${e.start} ${e.end} ${e.text}`, e]));
    return { ...r, edits: [...edits.values()] };
  });
  if (kept.length) return { ...f, rewrite: kept };
  const { rewrite: _, ...rest } = f;
  // (`T` without `rewrite`, which is optional in it.)
  return rest as T;
}

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
 * The command a rewrite ends with to stop the code at `n` after a failure, by how the file is read (`readAs`): `exit 1`
 * in a file run as a script, or `return 1` there in a function where `returns` (its caller then sees the failure). In a
 * file that may be sourced, where `exit 1` would end the shell that sources it, `return 1` in a function; outside one,
 * `return 1 2>/dev/null || exit 1` (`return` fails when the file is run, and then `exit 1` ends it).
 */
export function stopCommand(n: SyntaxNode, model: StateModel, returns: boolean): string {
  if (readAs(model.env(n), model.read) === 'script') return returns ? 'return 1' : 'exit 1';
  return ancestor(n, (x) => x.type === 'function_definition') ? 'return 1' : EITHER_STOP;
}

/** What `stopCommand` gives in a file that may be sourced or run, outside a function: `return` fails when the file is run, and then `exit` ends it. */
export const EITHER_STOP = 'return 1 2>/dev/null || exit 1';

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

/** The text of the document from the end of `n` to the end of its tree. */
export function textAfter(n: SyntaxNode): string {
  const { root } = treeOf(n);
  return root.text.slice(n.endIndex - root.startIndex);
}

/** The rewrite that puts `code` in place of the text from `start` to `end` (offsets in the tree of `n`, a node of it). */
export function replaceRange(n: SyntaxNode, start: number, end: number, code: string): Rewrite {
  return { code, edits: treeOf(n).own ? [{ start, end, text: code }] : [] };
}

/** A name for a variable the rewrite adds, that the document does not use: `base`, else `base2`, `base3`… */
export function unusedName(n: SyntaxNode, base: string): string {
  const used = new Set(documentRoot(n).text.match(/\w+/g));
  for (let i = 1; ; i++) {
    const name = i === 1 ? base : `${base}${i}`;
    if (!used.has(name)) return name;
  }
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
  return applyRewrite(n.text, { edits: changes }, n.startIndex);
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
  // (`a&&b`: `then` needs a blank after it.)
  const then = /\s/.test(n.text.charAt(and.endIndex - n.startIndex)) ? '; then' : '; then ';
  // (The whole of `n`, here-documents included, is replaced: `fi` is before their bodies.)
  return replaceRange(n, n.startIndex, n.endIndex, changed(n, [{ start: n.startIndex, end: n.startIndex, text: 'if ' }, { start: and.startIndex - blanks, end: and.endIndex, text: then },
    { start: headEnd(right), end: headEnd(right), text: '; fi' }]));
}

/** Where a statement put in place of another would not stand as one: `x | b`, `! x`, `time x`. */
const BOUND: ReadonlySet<string> = new Set(['pipeline', 'negated_command', 'time_statement', 'coproc_statement', 'redirected_statement']);

/** Whether statements put in place of the statement `n` need a group: where `n` is bound (`x | b`) or not first in a list. */
const grouped = (n: SyntaxNode): boolean => BOUND.has(n.parent!.type) || (n.parent!.type === 'list' && n.parent!.namedChildren[0] !== n);

/**
 * `code`, a list of statements, as one statement in place of the statement `n`: as it is where `n` stands alone or
 * first in an `&&` or `||` list (`local x; x=$(f) || return`); else in a group (`a && { local x; x=$(f); }`).
 */
export function inPlaceOf(n: SyntaxNode, code: string): string {
  return grouped(n) ? `{ ${code}; }` : code;
}

/**
 * The text of the statement `n` with `changes` made (edits within it), `before` put before it and `after` after it, but
 * before the bodies of its here-documents (`local x <<EOF; x=$(g)⏎…⏎EOF`); in a group as `inPlaceOf` puts it.
 */
export function around(n: SyntaxNode, changes: readonly TextEdit[], before: string, after: string): string {
  const group = grouped(n);
  const head = headEnd(n);
  return changed(n, [{ start: n.startIndex, end: n.startIndex, text: `${group ? '{ ' : ''}${before}` }, ...changes, { start: head, end: head, text: `${after}${group ? '; }' : ''}` }]);
}

/** The rewrite that puts `code` in place of the text from the start of node `from` to the end of node `to`, a later one of the same tree. */
export function replaceSpan(from: SyntaxNode, to: SyntaxNode, code: string): Rewrite {
  return { code, edits: treeOf(from).own ? [{ start: from.startIndex, end: to.endIndex, text: code }] : [] };
}

/**
 * The shell to give a command line as a string (`bash -c 'echo "$v"'`), where a variable set first is to be read: the
 * shell of the script (bash when not known), which runs a builtin as the script does. `sh` may be dash, whose `echo`
 * and `printf` take no options and lack `%q` and `%b`: there, a program (a name that is no builtin), or a builtin that
 * prints (`echo`, `printf`) with no option word and no such format; else undefined, for no edits.
 */
export function stringShell(shell: Shell | undefined, name: string, words: readonly string[]): string | undefined {
  if (shell !== 'sh') return shell ?? 'bash';
  return !Object.hasOwn(builtins, name) || (!!builtins[name].prints && !words.some((w) => /^['"]?-|%[qb]/.test(w))) ? 'sh' : undefined;
}
