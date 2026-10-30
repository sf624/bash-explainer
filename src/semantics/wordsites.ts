// What the state at a word does not show by itself (src/semantics/words.ts reads them): the names a statement may
// assign before one of its words is expanded, the value of `$_` after a command that is only an assignment, and
// whether the script changes its directory.
import { parseExpansion } from '../expansion';
import { ancestor, assignmentsOnly, descendants, field, redirectionsOf, type SyntaxNode } from '../syntax/tree';
import { STATEMENTS } from './env';
import { ARITH_ASSIGNED, attribute, refTarget, type ShellState, type StateModel } from './state';

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

const cdCache = new WeakMap<SyntaxNode, boolean>();
/** Whether the script changes its directory anywhere (`cd`, `pushd`, `popd`): the model does not follow it. */
export function changesDirectory(n: SyntaxNode): boolean {
  let root = n;
  while (root.parent) root = root.parent;
  let v = cdCache.get(root);
  if (v === undefined) cdCache.set(root, (v = descendants(root, ['command']).some((c) => ['cd', 'pushd', 'popd'].includes(field(c, 'name')?.text ?? ''))));
  return v;
}

/** What a statement may assign: names, and the defaults `${x:=word}` assign, with the text of the word. */
interface Assigned { names: Set<string>; defaults: { name: string; word: string }[] }
const unreliableCache = new WeakMap<SyntaxNode, Assigned>();
const unreliableInWordsCache = new WeakMap<SyntaxNode, Assigned>();
/**
 * The variables an arithmetic expression or a `${x:=word}` may assign in the statement that holds `n` (through
 * the substitutions around it): the state there is the one before the statement, so their values are not known.
 * (A simple command expands its words, or makes its assignments, before its redirections: what those assign does
 * not reach them.) What a default assigns through a nameref or an integer, the state says (`unreliableAt`).
 */
export function unreliableNames(n: SyntaxNode): Set<string> {
  return assignedIn(n).names;
}

/**
 * The variables the statement that holds `n` may assign before `n` is expanded (`unreliableNames`), with what its
 * defaults assign as the attributes in `st` say: a nameref's target (`declare -n r=b; ${r:=x}` assigns b), and where that
 * is an integer, what the arithmetic of the word assigns (`declare -i n; ${n:=b=3}` assigns b); `all` where any
 * variable may be (a target not known, a word of an integer with an expansion in it). Checked with bash 5.2
 * (test/readings.test.ts).
 */
export function unreliableAt(n: SyntaxNode, st: ShellState): ReadonlySet<string> | 'all' {
  const { names, defaults } = assignedIn(n);
  if (!defaults.length) return names;
  const out = new Set(names);
  for (const { name, word } of defaults) {
    const target = refTarget(st, name);
    if (target === '*') return 'all';
    out.add(target);
    if (attribute(st, target, 'i') === 'off') continue;
    if (/[$`]/.test(word)) return 'all';
    for (const m of word.matchAll(ARITH_ASSIGNED)) out.add(m[1] ?? m[3] ?? m[4]);
  }
  return out;
}

function assignedIn(n: SyntaxNode): Assigned {
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
  const seen = cache.get(top);
  if (seen) return seen;
  const names = new Set<string>();
  const defaults: Assigned['defaults'] = [];
  // (Not `let`: its words are expanded before it runs.)
  for (const a of descendants(top, [...ARITH, 'expansion'])) {
    if (skip.some((r) => inside(a, r))) continue;
    if (a.type === 'expansion') {
      const p = parseExpansion(a.text);
      if (p && (p.op === ':=' || p.op === '=')) {
        names.add(p.name);
        defaults.push({ name: p.name, word: p.parts.find((q) => q.role === 'word')?.text ?? '' });
      }
      continue;
    }
    for (const m of a.text.matchAll(ARITH_ASSIGNED)) names.add(m[1] ?? m[3] ?? m[4]);
  }
  const out = { names, defaults };
  cache.set(top, out);
  return out;
}
