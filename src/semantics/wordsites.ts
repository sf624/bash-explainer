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

/**
 * What a statement may assign: names, the texts of its arithmetic, and the defaults `${x:=word}` assign, with the text of
 * the word; each with the innermost statement that holds it (`at`).
 */
interface Assigned { names: Set<string>; arith: { text: string; at: SyntaxNode }[]; defaults: { name: string; word: string; colon: boolean; at: SyntaxNode }[] }
const unreliableCache = new WeakMap<SyntaxNode, Assigned>();
const unreliableInWordsCache = new WeakMap<SyntaxNode, Assigned>();
/**
 * The variables an arithmetic expression or a `${x:=word}` may assign in the statement that holds `n` (through
 * the substitutions around it): the state there is the one before the statement, so their values are not known.
 * (A simple command expands its words, or makes its assignments, before its redirections: what those assign does
 * not reach them.) What the values arithmetic reads assign, and what a default assigns through a nameref or an
 * integer, the state says (`unreliableAt`).
 */
export function unreliableNames(n: SyntaxNode): Set<string> {
  return assignedIn(n).names;
}

/** How many values read as expressions `arithAssigns` follows: past them, any variable may be assigned. */
const ARITH_READS = 32;

/**
 * The variables the arithmetic `text` may assign, run with the values of `st`: the names it assigns, and those that
 * the values it reads assign in turn, each read as an expression (`x='b=5'; $((x))` assigns b), all followed through
 * namerefs; `all` where a value it reads is not known here (or one a default of the same statement assigns,
 * `defaulted`), and where it pastes an expansion whose text is not a number or a variable's value (`$1`). A value
 * that an assignment of arithmetic gives is a number, which assigns nothing.
 */
function arithAssigns(text: string, st: ShellState, defaulted: ReadonlySet<string>): Set<string> | 'all' {
  const out = new Set<string>();
  const texts = [text];
  const seen = new Set<string>();
  /** Reads the variable `target`: false where its value is not known. */
  const read = (target: string): boolean => {
    if (defaulted.has(target)) return false;
    if (seen.has(target)) return true;
    seen.add(target);
    const v = st.variables.get(target);
    if (!v || v.declared === 'unknown' || v.set === 'unknown' || v.kept) return false;
    if (v.set === 'off') return true;
    if (v.value === undefined) return false;
    texts.push(v.value);
    return true;
  };
  for (let t = texts.pop(); t !== undefined; t = texts.pop()) {
    if (seen.size > ARITH_READS) return 'all';
    // (`$x` and `${x}` paste the value, which is read as an expression, as `x` is; `$(( ))` in it is an expression in
    // parentheses. `$#`, `${#x}` and constants are numbers: `16#ff`, `0x1f`.)
    const plain = t.replace(/\$\(\(/g, '((').replace(/\$\{?([A-Za-z_]\w*)\}?/g, ' $1 ').replace(/\$[#?$!]|\$\{#\w+\}/g, ' 0 ').replace(/\b\d+#[\w@]*|\b0[xX][\dA-Fa-f]*|\b\d+/g, ' 0 ');
    if (/[$`]/.test(plain)) return 'all';
    for (const m of plain.matchAll(/(?<!\w)([A-Za-z_]\w*)\s*(\[)?/g)) {
      // (After an element, what is said of the element: `a[i]=5` assigns a, `a[i]` reads a value not known here.)
      const rest = plain.slice(m.index + m[0].length);
      const after = m[2] ? rest.slice(rest.indexOf(']') + 1) : rest;
      const target = refTarget(st, m[1]);
      if (target === '*') return 'all';
      const plainAssign = /^\s*=(?!=)/.test(after);
      if (plainAssign || /^\s*(?:(?:[-+*/%&^|]|<<|>>)=|\+\+|--)/.test(after) || /(?:\+\+|--)\s*$/.test(plain.slice(0, m.index))) out.add(target);
      if (!plainAssign && (m[2] || !read(target))) return 'all';
    }
  }
  return out;
}

/**
 * The variables the statement that holds `n` may assign before `n` is expanded (`unreliableNames`), with what its
 * arithmetic and its defaults assign as the values and attributes in `st` say: what the values arithmetic reads assign
 * (`arithAssigns`: `x='b=5'; cp $((x)) $b` assigns b); a nameref's target (`declare -n r=b; ${r:=x}` assigns b), and
 * where that is an integer, what the arithmetic of the word assigns (`declare -i n; ${n:=b=3}` assigns b, `${n:=x}` what
 * the value of x does); `all` where any variable may be (a target not known, a value read that is not known). Checked
 * with bash 5.2 (test/readings.test.ts).
 */
export function unreliableAt(n: SyntaxNode, st: ShellState): ReadonlySet<string> | 'all' {
  const all = assignedIn(n);
  if (!all.names.size && !all.arith.length) return all.names;
  // (Only what a statement that holds `n` expands: the walk runs the other statements of a `$( )` in turn, before it.)
  const holds = (x: { at: SyntaxNode }): boolean => x.at.startIndex <= n.startIndex && n.endIndex <= x.at.endIndex;
  const arith = all.arith.filter(holds).map((x) => x.text);
  const defaults = all.defaults.filter(holds);
  const out = new Set(all.names);
  const targets = defaults.map(({ name }) => refTarget(st, name));
  if (targets.includes('*')) return 'all';
  const integer = defaults.filter((_, i) => attribute(st, targets[i], 'i') !== 'off');
  // (A default whose variable is set, or not empty, as the state says, assigns nothing, unless something else in the
  // statement may change it before: `declare -n r=b; b=1; cp ${r:=x} $b` gives the value of b.)
  const live = defaults.filter((d, i) => arith.length || integer.length || targets.some((t, j) => j !== i && t === targets[i]) || !leftAlone(d, targets[i], st));
  const defaulted = new Set(live.map((d) => targets[defaults.indexOf(d)]));
  for (const t of defaulted) out.add(t);
  for (const text of [...arith, ...integer.map((d) => d.word)]) {
    const assigned = arithAssigns(text, st, defaulted);
    if (assigned === 'all') return 'all';
    for (const x of assigned) out.add(x);
  }
  return out;
}

/** Whether the default `d`, of the variable `target`, assigns nothing in `st`: `${x:=w}` of a value not empty, `${x=w}` of one set. */
function leftAlone(d: Assigned['defaults'][number], target: string, st: ShellState): boolean {
  const v = st.variables.get(target);
  if (!v || v.declared === 'unknown' || v.set !== 'on' || v.kept) return false;
  return !d.colon || (v.value !== undefined && v.value !== '');
}

/** The text of the arithmetic of `a` (`$(( ))`, `(( ))`, the three parts of `for (( ))`), without the body of a loop. */
function arithText(a: SyntaxNode): string {
  const parts = a.namedChildren.filter((c) => c.type !== 'do_group');
  if (!parts.length) return '';
  let root = a;
  while (root.parent) root = root.parent;
  return root.text.slice(parts[0].startIndex - root.startIndex, parts[parts.length - 1].endIndex - root.startIndex);
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
  const arith: Assigned['arith'] = [];
  const defaults: Assigned['defaults'] = [];
  /** The innermost statement that holds `a` (itself, or `top`). */
  const statementOf = (a: SyntaxNode): SyntaxNode => {
    for (let x = a; x !== top; x = x.parent!) if (STATEMENTS.has(x.type)) return x;
    return top;
  };
  // (Not `let`: its words are expanded before it runs.)
  for (const a of descendants(top, [...ARITH, 'expansion'])) {
    if (skip.some((r) => inside(a, r))) continue;
    if (a.type === 'expansion') {
      const p = parseExpansion(a.text);
      if (p && (p.op === ':=' || p.op === '=')) {
        names.add(p.name);
        defaults.push({ name: p.name, word: p.parts.find((q) => q.role === 'word')!.text, colon: p.op === ':=', at: statementOf(a) });
      }
      continue;
    }
    for (const m of a.text.matchAll(ARITH_ASSIGNED)) names.add(m[1] ?? m[3] ?? m[4]);
    arith.push({ text: arithText(a), at: statementOf(a) });
  }
  const out = { names, arith, defaults };
  cache.set(top, out);
  return out;
}
