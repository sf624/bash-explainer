// What the state at a word does not show by itself (src/semantics/words.ts reads them): the names a statement may
// assign before one of its words is expanded, and the value of `$_` after a command that is only an assignment.
import { parseExpansion } from '../expansion';
import { ancestor, assignmentsOnly, descendants, redirectionsOf, type SyntaxNode } from '../syntax/tree';
import { STATEMENTS } from './env';
import { ARITH_ASSIGNED, type StateModel } from './state';

/** The nodes whose text is arithmetic. */
export const ARITH = new Set(['arithmetic_expansion', 'arithmetic_command', 'c_style_for_statement']);

/** Whether the simple command before `n` is only an assignment (it sets `$_` to nothing). */
function afterAssignment(n: SyntaxNode, model: StateModel): boolean {
  let root = n;
  while (root.parent) root = root.parent;
  let prev: SyntaxNode | undefined;
  // (A command in a subshell that `n` is not in sets the subshell's `$_`, and a function body runs elsewhere.)
  const here = model.env(n).links;
  // (The assignments of a command or a declaration are its words: `declare x=1` sets `$_` to `x=1`. The first part of
  // `for (( i = 0; … ))` is arithmetic, not a command: it leaves `$_`.)
  for (const c of descendants(root, ['command'])) {
    if (c.endIndex > n.startIndex) continue;
    if (ancestor(c, (x) => x.type === 'function_definition') || model.env(c).links.some((l) => !here.includes(l))) continue;
    if (!prev || c.endIndex >= prev.endIndex) prev = c;
  }
  return !!prev && assignmentsOnly(prev);
}

/** The value of `$_` where `n` is: empty after a command that is only an assignment; undefined otherwise. */
export function underscoreValue(n: SyntaxNode, model: StateModel): string | undefined {
  return afterAssignment(n, model) ? '' : undefined;
}

const unreliableCache = new WeakMap<SyntaxNode, Set<string>>();
const unreliableInWordsCache = new WeakMap<SyntaxNode, Set<string>>();
/**
 * The variables an arithmetic expression or a `${x:=word}` may assign in the statement that holds `n` (through
 * the substitutions around it): the state there is the one before the statement, so their values are not known.
 * (A simple command expands its words, or makes its assignments, before its redirections: what those assign does
 * not reach them.)
 */
export function unreliableNames(n: SyntaxNode): Set<string> {
  let top = n;
  let open = true;
  for (let x = n.parent; x; x = x.parent) {
    if (x.type === 'command_substitution' || x.type === 'process_substitution') open = true;
    else if (open && STATEMENTS.has(x.type)) {
      top = x;
      open = false;
    }
  }
  const redirs = top.type === 'command' ? redirectionsOf(top) : [];
  const inside = (a: SyntaxNode, r: SyntaxNode) => a.startIndex >= r.startIndex && a.endIndex <= r.endIndex;
  const skip = redirs.some((r) => inside(n, r)) ? [] : redirs;
  const cache = skip.length ? unreliableInWordsCache : unreliableCache;
  let names = cache.get(top);
  if (names) return names;
  names = new Set();
  // (Not `let`: its words are expanded before it runs.)
  for (const a of descendants(top, [...ARITH, 'expansion'])) {
    if (skip.some((r) => inside(a, r))) continue;
    if (a.type === 'expansion') {
      const p = parseExpansion(a.text);
      if (p && (p.op === ':=' || p.op === '=')) names.add(p.name);
      continue;
    }
    for (const m of a.text.matchAll(ARITH_ASSIGNED)) names.add(m[1] ?? m[3] ?? m[4]);
  }
  cache.set(top, names);
  return names;
}
